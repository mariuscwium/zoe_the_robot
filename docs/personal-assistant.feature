# Family Assistant Agent — Gherkin Feature Specification
# Version: 0.6.0 | Status: Draft
# Updated: 2025-03-10 — v6: all open questions resolved; weekly digest removed;
#   group chats excluded; multi-event image confirmation; recurring event deletion
#   via single message; full text in incoming log; bootstrap script on every deploy


# ─────────────────────────────────────────────
# FEATURE 0: Family Member Registry & Whitelist
# ─────────────────────────────────────────────

Feature: Family Member Registry as Telegram Whitelist

  The registry maps Telegram chat_ids to member profiles and is the sole
  access whitelist. No phone numbers stored. The bootstrap script is
  idempotent and runs on every deployment. Admin /commands are intercepted
  before Claude. Group chats are silently rejected regardless of chat_id
  registration status.

  Background:
    Given "registry:members" exists in Redis as a JSON array
    And each member has: id, name, chatId (integer), timezone, role, isAdmin
    And Marius is the registered admin (isAdmin: true)

  # --- Bootstrap ---

  Scenario: Bootstrap script runs on deployment (idempotent)
    Given the bot has been deployed
    And the bootstrap script is run with: --chatid=111111 --name=Marius --timezone=Pacific/Auckland
    When the script executes
    Then it merges the admin entry into the registry (does not overwrite other members)
    And re-registers the Telegram webhook with the correct URL and secret token
    And subsequent messages from chatId 111111 are processed normally
    And re-running the script with the same parameters produces the same result

  Scenario: Admin finds their chat_id before bootstrap
    Given the bot is deployed but the registry is empty
    And Marius sends any message to the bot
    When the webhook fires
    Then the whitelist check fails silently (HTTP 200, no reply)
    And the incoming message log records the update including the chat_id
    And Marius reads the chat_id from the debug UI incoming message log

  # --- Happy Paths ---

  Scenario: Admin adds a new family member
    Given Marius sends "/add-member id:sarah name:Sarah chatid:222222 timezone:Pacific/Auckland role:parent"
    When the webhook intercepts the "/" prefix
    Then it parses the command server-side
    And adds Sarah (chatId: 222222) to the registry
    And sends Marius: "Sarah added. They can now message the assistant."
    And Claude is never invoked

  Scenario: Admin removes a member
    Given Marius sends "/remove-member sarah"
    Then Sarah's entry is removed from the registry
    And future messages from chatId 222222 are silently dropped

  Scenario: Admin lists current members
    Given Marius sends "/list-members"
    Then the handler replies with all member names, chat_ids, and roles

  # --- Edge Cases ---

  Scenario: Message from unregistered chat_id
    Given an update arrives from chat_id 999999 in a private chat
    And 999999 is not in the registry
    Then the handler responds HTTP 200 with no reply and no logging

  Scenario: Update from a group chat (registered or not)
    Given a Telegram update has chat.type = "group"
    When the webhook checks the chat type
    Then it responds HTTP 200 with no reply and no logging
    And does not check the registry
    And does not invoke Claude

  Scenario: Update from a channel or supergroup
    Given chat.type is "channel" or "supergroup"
    Then the same silent rejection applies

  Scenario: Non-admin sends an admin command
    Given Sarah (isAdmin: false) sends "/list-members"
    Then the handler sends Sarah: "I don't recognise that command."
    And does not modify the registry or invoke Claude

  Scenario: Admin sends a malformed command
    Given Marius sends "/add-member Sarah"
    Then the handler sends usage instructions
    And does not modify the registry


# ─────────────────────────────────────────────
# FEATURE 1: Telegram Webhook Ingestion
# ─────────────────────────────────────────────

Feature: Telegram Webhook Message Ingestion

  POST /api/telegram handles text, photos, and documents from registered
  members in private chats. Validation, chat type check, and whitelist
  check happen before any processing. Full message text is stored in
  the incoming log.

  Background:
    Given POST /api/telegram is live
    And TELEGRAM_WEBHOOK_SECRET is set
    And the registry is populated

  # --- Happy Paths ---

  Scenario: Registered member sends a text message
    Given Sarah sends "what's on the shopping list?" in a private chat
    When the webhook processes the update
    Then it validates the X-Telegram-Bot-Api-Secret-Token header
    And confirms chat.type is "private"
    And resolves Sarah's identity by chatId
    And loads Sarah's conversation history
    And invokes Claude with the text
    And sends the reply to Sarah's chatId via sendMessage
    And appends to log:incoming: timestamp, "sarah", "text", full message text
    And returns HTTP 200

  Scenario: Registered member sends a photo
    Given Marius sends a photo in a private chat
    When the webhook processes the update
    Then it calls getFile with the largest photo's file_id
    And downloads the image from the Telegram file API (requires bot token)
    And base64-encodes it in memory
    And invokes Claude with the image as a Vision input
    And appends to log:incoming with message type "photo"
    And the image is never written to disk or storage

  Scenario: Registered member sends a photo with caption
    Given Sarah sends a screenshot with caption "can you file this?"
    Then Claude receives both the image and the caption as a combined input

  # --- Edge Cases ---

  Scenario: Webhook secret token is missing or wrong
    Given a POST without a valid X-Telegram-Bot-Api-Secret-Token
    Then the handler returns HTTP 403 and does not invoke Claude

  Scenario: Telegram file download fails
    Given Marius sends a photo
    And the HTTP download from Telegram times out
    Then Claude is invoked with any caption text only
    And Marius receives: "I couldn't download that image — could you try again?"

  Scenario: Unsupported message type (voice, sticker, etc.)
    Given Sarah sends a voice message
    Then Sarah receives: "I can only handle text and images for now."
    And Claude is not invoked

  Scenario: Agent processing exceeds 25 seconds
    Given a message triggers a long tool chain
    When 25 seconds elapse without a response
    Then the sender receives: "Still working on it..."
    And the agent continues and sends a follow-up message on completion


# ─────────────────────────────────────────────
# FEATURE 2: Image Ingestion & Autonomous Action
# ─────────────────────────────────────────────

Feature: Image Ingestion with Autonomous Action and Bulk Confirmation

  Single events and non-calendar content are acted on immediately.
  When an image contains 4 or more calendar events, the agent
  summarises and asks for YES confirmation before creating any.

  Background:
    Given Claude receives a base64-encoded image as a Vision input
    And the system prompt instructs autonomous action for 1-3 events
    And confirmation is required for 4+ calendar events from a single image

  # --- Single event / non-calendar (autonomous) ---

  Scenario: Screenshot of a single calendar invitation
    Given Marius sends a photo of a birthday party invite (Saturday 3pm, 42 Oak St)
    When Claude processes the image and detects 1 calendar event
    Then it calls create_calendar_event immediately
    And Marius receives a plain-text confirmation

  Scenario: Screenshot with packing list and event — creates event and doc
    Given Sarah sends a school camp notification with dates, packing list, permission deadline
    When Claude detects 2 calendar events and associated detail
    Then it creates both events autonomously
    And calls create_doc for the packing list
    And the event description references the doc slug (no URL)
    And Sarah receives a summary of what was created

  Scenario: Photo of a shopping list
    Given Sarah sends a photo of a grocery list
    When Claude processes the image
    Then it calls add_shopping_item for each legible item
    And Sarah receives a confirmation with the items added

  # --- Multi-event image (confirmation required) ---

  Scenario: Term calendar with many events — confirmation required
    Given Sarah sends a photo of a school term calendar with 8 events
    When Claude processes the image and detects 8 calendar events
    Then it does NOT create any events
    And it calls confirm_action with a summary: "I can see 8 events: [list]. Add all to the family calendar?"
    And Sarah receives the summary and is asked to reply YES

  Scenario: Multi-event confirmation — accepted
    Given confirm_action has sent the summary to Sarah
    And Sarah replies "YES"
    When the pending_confirm key resolves
    Then the agent creates all 8 calendar events
    And Sarah receives: "Done — added 8 events to the family calendar."

  Scenario: Multi-event confirmation — declined
    Given confirm_action has sent the summary to Sarah
    And Sarah replies "no thanks"
    Then no events are created
    And Sarah receives: "OK, nothing was added."

  Scenario: Multi-event confirmation expires (5-minute TTL)
    Given confirm_action was sent but Sarah did not reply within 5 minutes
    When the pending_confirm key expires
    Then the next message from Sarah is treated as a new request
    And no events are created from the original image

  # --- Edge cases ---

  Scenario: Image is ambiguous
    Given Marius sends a blurry or unrelated photo
    Then Claude replies describing what it saw and asking for direction
    And no tools are called

  Scenario: Image summary stored in conversation history
    Given Claude acted on an image
    When history is saved to Redis
    Then the image content block is replaced with a text summary
    And subsequent turns can reference "that email I just sent"


# ─────────────────────────────────────────────
# FEATURE 3: Conversation History
# ─────────────────────────────────────────────

Feature: Per-member Conversation History

  Rolling 10-turn window per member, 7-day TTL, stored in Redis.
  Image data replaced with text summaries post-processing.

  Background:
    Given history at "conversation:<member_id>" with 7-day TTL
    And capped at 10 turns

  Scenario: Member continues a prior turn
    Given Marius created a dentist appointment in the last turn
    And Marius sends "actually make it 3pm"
    Then the agent uses history to understand the reference
    And calls confirm_action, then replaces the event at 3pm

  Scenario: Member references a previously processed image
    Given Sarah's history contains "[Image: school trip email — created 2 events and doc school-camp-march-2025]"
    And Sarah sends "what was the permission slip deadline in that email?"
    Then the agent retrieves the answer from history or the linked doc
    And replies with the correct deadline

  Scenario: History expired after 7 days
    Given Marius last messaged 8 days ago
    When Marius messages again
    Then the handler starts with empty history and no stale context

  Scenario: History key contains malformed JSON
    Given "conversation:sarah" has invalid JSON
    Then the handler falls back to empty history and continues normally


# ─────────────────────────────────────────────
# FEATURE 4: Claude Agent & Tool Definitions
# ─────────────────────────────────────────────

Feature: Claude Agent with Full Tool Suite

  Agent receives identity, context, and history on every call.
  Authorship injected server-side. No set_reminder tool.
  Recurring events are deletable via single conversational message.

  Background:
    Given the model is "claude-sonnet-4-20250514"
    And tools are registered as per the RFC tool registry
    And set_reminder does NOT exist

  # --- Happy Paths ---

  Scenario: Member sets a reminder via calendar event
    Given Marius sends "remind me to call the accountant Thursday at 10am"
    When the agent calls create_calendar_event
    Then the event has reminders.overrides: [{ method: "popup", minutes: 0 }]
    And Marius receives a confirmation
    And no Redis reminders key is written

  Scenario: Member sets a recurring reminder
    Given Sarah sends "remind me to take medication every morning at 8am"
    When the agent calls create_calendar_event with recurrence: ["RRULE:FREQ=DAILY"]
    Then a recurring event is created with a daily popup alarm
    And Sarah receives confirmation

  Scenario: Member deletes a recurring event via single message
    Given Sarah sends "cancel my daily medication reminder"
    When the agent finds the matching recurring event
    Then it calls confirm_action: "Delete recurring event: Take medication (repeats daily). This will cancel all future occurrences."
    And Sarah replies YES
    Then the agent calls delete_calendar_event on the full recurring series
    And Sarah receives confirmation
    And Sarah does not need to open Google Calendar to manage this

  Scenario: Member notifies another member
    Given Sarah sends "add school concert Friday 7pm and let Marius know"
    When the agent creates the event and calls notify_member for Marius
    Then notify_member resolves Marius's chatId from the registry
    And sends a Telegram message to Marius: "Sarah added School Concert on Friday at 7pm."
    And native Telegram read receipts show Sarah when Marius has seen it
    And no pending_notify Redis key is created

  Scenario: Destructive action — confirmed
    Given Marius sends "delete the dentist appointment Thursday"
    And the agent calls confirm_action
    And Marius replies YES
    Then the agent calls delete_calendar_event
    And the audit log records the deletion

  Scenario: Destructive action — declined
    Given confirm_action has sent the request
    And Marius replies "no leave it"
    Then delete_calendar_event is not called
    And the agent replies: "OK, left as is."

  # --- Edge Cases ---

  Scenario: Reminder requested without a time
    Given Sarah sends "remind me about the permission slip"
    Then the agent asks for a time before calling create_calendar_event

  Scenario: notify_member called with unknown name
    Given the agent calls notify_member with name "Dave"
    Then the tool returns "No family member named Dave found"
    And the agent replies with the known member names

  Scenario: Agent loop exceeds 8 tool calls
    Given 8 consecutive tool calls with no text response
    Then the agent is forced to produce a final text response immediately


# ─────────────────────────────────────────────
# FEATURE 5: Memory Layer & Document Store
# ─────────────────────────────────────────────

Feature: Private Redis File-Based Memory

  All memory in Upstash Redis as markdown strings. No public URLs.
  No vector database. Docs retained indefinitely, deleted explicitly.
  Access via agent (Telegram) or authenticated debug UI only.

  Background:
    Given all memory is under "memory:*" keys in Upstash Redis
    And no HTTP endpoint exposes any memory key publicly
    And the choice of Redis over dedicated memory systems is documented in §6.5

  Scenario: Memory doc created from image extraction
    Given Claude calls create_doc with slug "school-camp-march-2025"
    Then the Redis key "memory:family:docs:school-camp-march-2025" is set
    And "memory:family:docs:_index" is updated with slug, description, date
    And no URL is generated

  Scenario: Member retrieves a doc via the agent
    Given Marius sends "show me the school camp packing list"
    When the agent calls read_memory for "family/docs/school-camp-march-2025"
    Then it reads from Redis and replies with the content in plain text
    And no URL is mentioned

  Scenario: Member searches across memory
    Given Sarah sends "what do we have about soccer?"
    When the agent calls search_memory with query "soccer"
    Then the tool scans memory:* keys and returns matching excerpts
    And the agent summarises for Sarah

  Scenario: Doc deleted via agent
    Given Marius sends "delete the old camping notes"
    When the agent identifies the relevant key
    Then it calls confirm_action before calling write_memory or any delete operation
    And on confirmation, deletes the key and updates the doc index
    And the audit log records the deletion

  Scenario: Doc retained indefinitely without explicit action
    Given a doc was created 6 months ago
    Then it still exists in Redis with no TTL-based expiry
    And can only be removed via the agent (with confirm_action) or the debug UI

  Scenario: Redis unreachable
    Given the Upstash endpoint returns a network error
    Then the tool returns an error result
    And the sender is informed that memory is temporarily unavailable


# ─────────────────────────────────────────────
# FEATURE 6: Google Calendar with Native Reminders
# ─────────────────────────────────────────────

Feature: Shared Google Calendar with Native Reminders

  All reminders are calendar events with native alarms. No custom
  reminder cron. Recurring events created by the bot are deletable
  via a single Telegram message.

  Background:
    Given Google Calendar credentials are configured
    And all datetimes are pre-resolved ISO 8601 before tool calls

  Scenario: Creating a popup reminder at event time
    Given create_calendar_event is called with reminderMinutes: 0
    Then the event has reminders.useDefault: false
    And reminders.overrides: [{ method: "popup", minutes: 0 }]

  Scenario: Creating a recurring daily event with alarm
    Given create_calendar_event is called with recurrence: ["RRULE:FREQ=DAILY"] and reminderMinutes: 0
    Then a recurring event is created with a daily popup alarm

  Scenario: Deleting a recurring event series via chat
    Given Sarah sends "cancel my daily medication reminder"
    And the agent finds the recurring event and calls confirm_action
    And Sarah replies YES
    Then delete_calendar_event deletes the full series
    And Sarah does not need Google Calendar app access

  Scenario: Calendar event linked to memory doc — no URL
    Given a calendar event and memory doc were created from an image
    Then the event description contains: "Details saved. Ask the assistant about school-camp-march-2025."
    And no URL appears in the description

  Scenario: Google refresh token expired
    Given the Google API returns 401 invalid_grant
    Then the sender is told to re-authorise Google Calendar
    And no further calendar calls are attempted this session

  Scenario: Multiple events match a deletion request
    Given get_calendar_events returns 3 events matching the description
    Then the agent lists them and asks for clarification
    And does not call delete_calendar_event


# ─────────────────────────────────────────────
# FEATURE 7: Audit Log
# ─────────────────────────────────────────────

Feature: Family Audit Log

  Every mutating tool call appended to "memory:family:log" server-side.
  Queryable via agent. Viewable and filterable in debug UI. Archived
  manually via debug UI in v1 (weekly cron deferred to v2).

  Background:
    Given every mutating tool wrapper appends to "memory:family:log"

  Scenario: Mutating action logged automatically
    Given Sarah calls create_doc via the agent
    Then the wrapper appends: "2025-03-10T11:03:07+13:00 | Sarah | create_doc | school-camp-march-2025"
    And Claude does not write the log entry

  Scenario: Debug UI edit logged
    Given a developer edits a memory file via the debug UI
    Then the save appends: "2025-03-10T... | DEBUG | write_memory | family/todos (via debug UI)"

  Scenario: Member queries the log via chat
    Given Marius sends "who last updated the shopping list?"
    When the agent reads "family/log"
    Then it finds the relevant entry and replies with member name and time

  Scenario: Manual archive triggered from debug UI
    Given the developer clicks "Archive entries older than 30 days" in the Audit Log panel
    Then entries older than 30 days are moved to "memory:archive:log-YYYY-MM"
    And the active log retains only recent entries
    And an archive entry is appended: "SYSTEM | archive | Archived N audit entries to log-2025-02"

  Scenario: Log append fails
    Given the Redis write for the log append fails
    Then the primary tool action is not rolled back
    And the sender receives their normal response


# ─────────────────────────────────────────────
# FEATURE 8: Debug Interface
# ─────────────────────────────────────────────

Feature: Password-protected Debug Interface

  Single-page UI at a non-discoverable route. bcrypt password +
  JWT cookie + IP lockout. Four panels: memory browser, conversation
  history, audit log, incoming message log (full text). Manual archive
  trigger in v1 (replaces weekly cron for archiving).

  Background:
    Given the debug UI is at GET /{DEBUG_PATH}
    And DEBUG_PATH is an env-configured non-guessable slug
    And authentication uses bcrypt + httpOnly JWT (24hr) + IP lockout after 3 failures

  # --- Authentication ---

  Scenario: Successful login
    Given the developer submits the correct password
    Then an httpOnly signed JWT cookie is set (24hr)
    And the failed attempt counter for the IP is reset

  Scenario: Three failed attempts trigger lockout
    Given an IP has failed 3 times
    Then the login endpoint returns 429 for 15 minutes

  Scenario: Expired session
    Given the JWT has expired
    When the developer accesses any /debug/* route
    Then they are redirected to the password form

  # --- Memory File Browser ---

  Scenario: Developer views and edits a memory file
    Given the developer clicks "memory:family:todos"
    Then the content renders as markdown
    And an Edit button opens a textarea
    And saving writes to Redis and appends an audit log entry

  Scenario: Developer deletes a memory key
    Given the developer clicks Delete on a key
    Then a confirmation dialog appears
    And if confirmed, the key is deleted and the audit log records it

  # --- Conversation History ---

  Scenario: Developer views a member's conversation
    Given the developer selects Marius from the dropdown
    Then his rolling transcript is shown with image turns as "[Image: <summary>]"

  Scenario: Developer clears a member's history
    Given the developer confirms Clear History for Sarah
    Then "conversation:sarah" is deleted from Redis

  # --- Audit Log Viewer ---

  Scenario: Developer filters audit log by member
    Given the developer selects "Sarah" in the filter
    Then only Sarah's entries are shown in reverse chronological order

  Scenario: Developer triggers manual archive
    Given the developer clicks "Archive entries older than 30 days"
    Then old entries are moved to memory:archive:log-YYYY-MM
    And the panel refreshes showing only recent entries

  # --- Incoming Message Log ---

  Scenario: Developer views the incoming message log
    Given the developer opens the Incoming Messages panel
    Then entries from "log:incoming" are shown paginated
    And each shows: timestamp, member name, message type, full message text
    And no phone numbers appear anywhere

  Scenario: Developer expands a message entry
    Given the developer clicks on a log entry
    Then the full message text is shown
    And if a photo was attached, a thumbnail is shown if base64 data is still in conversation history

  Scenario: Developer trims the incoming log
    Given "log:incoming" has grown large
    When the developer clicks "Trim to 500 entries"
    Then only the 500 most recent entries are retained
