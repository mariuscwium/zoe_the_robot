/**
 * Dependency injection interfaces for all external services.
 * Production code uses real HTTP clients; tests inject digital twins.
 */

// --- Redis ---

export interface RedisClient {
  execute(command: string[]): Promise<RedisResult>;
  pipeline(commands: string[][]): Promise<RedisResult[]>;
}

export interface RedisResult {
  result: unknown;
  error?: string;
}

// --- Telegram ---

export interface TelegramClient {
  sendMessage(chatId: number, text: string): Promise<TelegramResult<TelegramMessage>>;
  getFile(fileId: string): Promise<TelegramResult<TelegramFile>>;
  downloadFile(filePath: string): Promise<Buffer>;
  setWebhook(params: SetWebhookParams): Promise<TelegramResult<boolean>>;
}

export interface TelegramMessage {
  message_id: number;
  chat: { id: number; type: string };
  date: number;
  text?: string;
}

export interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

export interface SetWebhookParams {
  url: string;
  secret_token?: string;
  allowed_updates?: string[];
}

export interface TelegramResult<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

// --- Google Calendar ---

export interface CalendarClient {
  listEvents(params: ListEventsParams): Promise<CalendarEventList>;
  insertEvent(event: CalendarEventInput): Promise<CalendarEvent>;
  getEvent(eventId: string): Promise<CalendarEvent>;
  deleteEvent(eventId: string): Promise<void>;
}

export interface ListEventsParams {
  timeMin?: string;
  timeMax?: string;
  singleEvents?: boolean;
  orderBy?: string;
  maxResults?: number;
  q?: string;
}

export interface CalendarEventInput {
  summary: string;
  description?: string;
  location?: string;
  start: EventDateTime;
  end: EventDateTime;
  recurrence?: string[];
  reminders?: EventReminders;
}

export interface CalendarEvent extends CalendarEventInput {
  id: string;
  status: string;
  htmlLink: string;
  created: string;
  updated: string;
}

export interface CalendarEventList {
  kind: string;
  items: CalendarEvent[];
  nextPageToken?: string;
}

export interface EventDateTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

export interface EventReminders {
  useDefault: boolean;
  overrides?: { method: string; minutes: number }[];
}

// --- Claude ---

export interface ClaudeClient {
  createMessage(params: ClaudeMessageParams): Promise<ClaudeMessage>;
}

export interface ClaudeMessageParams {
  model: string;
  max_tokens: number;
  system?: string;
  messages: ClaudeConversationMessage[];
  tools?: ClaudeTool[];
}

export interface ClaudeConversationMessage {
  role: "user" | "assistant";
  content: string | ClaudeContentBlock[];
}

export interface ClaudeContentBlock {
  type: string;
  [key: string]: unknown;
}

export interface ClaudeTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ClaudeMessage {
  id: string;
  type: string;
  role: string;
  content: ClaudeContentBlock[];
  model: string;
  stop_reason: string | null;
}

// --- Clock ---

export interface Clock {
  now(): Date;
}

// --- Calendar Provider (per-member OAuth) ---

export interface CalendarProvider {
  getClient(memberId: string): Promise<CalendarClient | null>;
}

// --- Combined Deps ---

export interface Deps {
  redis: RedisClient;
  telegram: TelegramClient;
  calendar: CalendarProvider;
  claude: ClaudeClient;
  clock: Clock;
}
