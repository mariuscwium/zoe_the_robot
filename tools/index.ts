import type { ClaudeTool } from "../lib/deps.js";

const readMemory: ClaudeTool = {
  name: "read_memory",
  description:
    "Read a memory document by key. Use logical paths like 'family/todos', 'family/shopping', or 'family/docs/school-camp-march-2025'. Returns the markdown content of the document.",
  input_schema: {
    type: "object",
    properties: {
      key: {
        type: "string",
        description:
          "The logical memory path to read, e.g. 'family/todos' or 'members/marius/notes'.",
      },
    },
    required: ["key"],
  },
};

const writeMemory: ClaudeTool = {
  name: "write_memory",
  description:
    "Write or overwrite a memory document. Use confirm_action first if overwriting an existing document with significant content. The server injects authorship automatically — do not include it in the content.",
  input_schema: {
    type: "object",
    properties: {
      key: {
        type: "string",
        description:
          "The logical memory path to write, e.g. 'family/todos' or 'family/docs/school-camp-march-2025'.",
      },
      content: {
        type: "string",
        description: "The full markdown content to write to the document.",
      },
    },
    required: ["key", "content"],
  },
};

const deleteMemory: ClaudeTool = {
  name: "delete_memory",
  description:
    "Delete a memory document by key. Always call confirm_action before deleting a document.",
  input_schema: {
    type: "object",
    properties: {
      key: {
        type: "string",
        description: "The logical memory path to delete.",
      },
    },
    required: ["key"],
  },
};

const listMemoryKeys: ClaudeTool = {
  name: "list_memory_keys",
  description:
    "List memory keys matching a glob pattern. Use to discover what documents exist before reading them.",
  input_schema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description:
          "A glob pattern to match keys, e.g. 'family/*' for all shared docs or 'members/marius/*' for personal docs. Use '*' to list all memory keys.",
      },
    },
    required: ["pattern"],
  },
};

const appendMemory: ClaudeTool = {
  name: "append_memory",
  description:
    "Append content to an existing memory document. Useful for adding items to lists (todos, shopping) without overwriting the full document. The server injects authorship automatically.",
  input_schema: {
    type: "object",
    properties: {
      key: {
        type: "string",
        description:
          "The logical memory path to append to, e.g. 'family/todos' or 'family/shopping'.",
      },
      content: {
        type: "string",
        description: "The content to append to the end of the document.",
      },
    },
    required: ["key", "content"],
  },
};

const listEvents: ClaudeTool = {
  name: "list_events",
  description:
    "List upcoming calendar events. Returns events from the shared family Google Calendar. Defaults to the next 7 days if days_ahead is not specified.",
  input_schema: {
    type: "object",
    properties: {
      days_ahead: {
        type: "number",
        description:
          "Number of days ahead to query. Defaults to 7 if not provided.",
      },
      query: {
        type: "string",
        description:
          "Optional text to filter events by summary or description.",
      },
    },
    required: [],
  },
};

const createEvent: ClaudeTool = {
  name: "create_event",
  description:
    "Create a calendar event on the shared family Google Calendar. All datetimes must be ISO 8601 format (pre-resolved by the system). Use reminders to set native Google Calendar popup alarms. For recurring events, use create_recurring_event instead.",
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "The event title.",
      },
      start_time: {
        type: "string",
        description: "ISO 8601 start datetime, e.g. '2025-03-15T14:00:00+13:00'.",
      },
      end_time: {
        type: "string",
        description: "ISO 8601 end datetime, e.g. '2025-03-15T15:00:00+13:00'.",
      },
      description: {
        type: "string",
        description:
          "Optional event description. When linking to a memory doc, reference the slug (not a URL).",
      },
      location: {
        type: "string",
        description: "Optional event location.",
      },
      reminders: {
        type: "array",
        items: {
          type: "object",
          properties: {
            method: {
              type: "string",
              description: "Reminder method: 'popup' or 'email'.",
            },
            minutes: {
              type: "number",
              description:
                "Minutes before the event to trigger the reminder. Use 0 for at event time.",
            },
          },
          required: ["method", "minutes"],
        },
        description:
          "Optional reminder overrides. For reminders at event time, use [{ method: 'popup', minutes: 0 }].",
      },
    },
    required: ["summary", "start_time", "end_time"],
  },
};

const createRecurringEvent: ClaudeTool = {
  name: "create_recurring_event",
  description:
    "Create a recurring calendar event on the shared family Google Calendar. Use for repeated reminders or regular events. The recurrence field takes an RRULE string.",
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "The event title.",
      },
      start_time: {
        type: "string",
        description: "ISO 8601 start datetime for the first occurrence.",
      },
      end_time: {
        type: "string",
        description: "ISO 8601 end datetime for the first occurrence.",
      },
      recurrence: {
        type: "string",
        description:
          "An RRULE string, e.g. 'RRULE:FREQ=DAILY' or 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR'.",
      },
      description: {
        type: "string",
        description: "Optional event description.",
      },
      location: {
        type: "string",
        description: "Optional event location.",
      },
    },
    required: ["summary", "start_time", "end_time", "recurrence"],
  },
};

const deleteCalendarEvent: ClaudeTool = {
  name: "delete_calendar_event",
  description:
    "Delete a calendar event by its Google Calendar event ID. Always call confirm_action first. For recurring events, this deletes the full series.",
  input_schema: {
    type: "object",
    properties: {
      event_id: {
        type: "string",
        description: "The Google Calendar event ID to delete.",
      },
    },
    required: ["event_id"],
  },
};

const findEvents: ClaudeTool = {
  name: "find_events",
  description:
    "Search calendar events by text query. Use to find events before updating or deleting them. Returns matching events with their IDs.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Text to search for in event summaries and descriptions.",
      },
      days_ahead: {
        type: "number",
        description:
          "Number of days ahead to search. Defaults to 30 if not provided.",
      },
    },
    required: ["query"],
  },
};

const searchNotion: ClaudeTool = {
  name: "search_notion",
  description:
    "Search the user's Notion workspace for pages by title or content. Returns matching pages with their IDs. Use this to find pages before reading or creating them.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search text to find pages by title or content.",
      },
    },
    required: ["query"],
  },
};

const readNotionPage: ClaudeTool = {
  name: "read_notion_page",
  description:
    "Read a Notion page's content as markdown. Returns the page title, URL, and full content. Always read a page before updating it.",
  input_schema: {
    type: "object",
    properties: {
      page_id: {
        type: "string",
        description: "The Notion page ID to read.",
      },
    },
    required: ["page_id"],
  },
};

const createNotionPage: ClaudeTool = {
  name: "create_notion_page",
  description:
    "Create a new Notion page under a parent page. Content is written as markdown and converted to Notion blocks. Use search_notion first to find the right parent page.",
  input_schema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "The page title.",
      },
      markdown: {
        type: "string",
        description: "The page content as markdown.",
      },
      parent_page_id: {
        type: "string",
        description:
          "The ID of the parent page. Use search_notion to find the right parent.",
      },
    },
    required: ["title", "markdown", "parent_page_id"],
  },
};

const updateNotionPage: ClaudeTool = {
  name: "update_notion_page",
  description:
    "Replace all content of a Notion page with new markdown. This is destructive — always read the page first with read_notion_page. Pages with more than 100 blocks cannot be updated; use append_notion_page instead.",
  input_schema: {
    type: "object",
    properties: {
      page_id: {
        type: "string",
        description: "The Notion page ID to update.",
      },
      markdown: {
        type: "string",
        description: "The new page content as markdown (replaces all existing content).",
      },
    },
    required: ["page_id", "markdown"],
  },
};

const appendNotionPage: ClaudeTool = {
  name: "append_notion_page",
  description:
    "Append markdown content to the end of an existing Notion page. Non-destructive — existing content is preserved. Good for adding to lists, notes, or logs.",
  input_schema: {
    type: "object",
    properties: {
      page_id: {
        type: "string",
        description: "The Notion page ID to append to.",
      },
      markdown: {
        type: "string",
        description: "The markdown content to append to the end of the page.",
      },
    },
    required: ["page_id", "markdown"],
  },
};

const visitLink: ClaudeTool = {
  name: "visit_link",
  description:
    "Visit a web URL and return the page content as markdown. Use this when a user shares a link or when you need to read a web page (recipes, articles, etc). Returns clean readable text extracted from the page.",
  input_schema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The full URL to visit, e.g. 'https://example.com/page'.",
      },
    },
    required: ["url"],
  },
};

const confirmAction: ClaudeTool = {
  name: "confirm_action",
  description:
    "Confirmation gate for destructive or bulk actions. Call this before any destructive operation (deleting events, overwriting memory docs) or before bulk calendar creation (4+ events from a single image). Present a clear summary of what will happen, then wait for the member to reply YES or NO.",
  input_schema: {
    type: "object",
    properties: {
      confirmed: {
        type: "boolean",
        description:
          "Whether the action has been confirmed by the member. Set to true only after the member explicitly confirms.",
      },
    },
    required: ["confirmed"],
  },
};

export const TOOL_DEFINITIONS: ClaudeTool[] = [
  readMemory, writeMemory, deleteMemory, listMemoryKeys, appendMemory,
  listEvents, createEvent, createRecurringEvent, deleteCalendarEvent, findEvents,
  searchNotion, readNotionPage, createNotionPage, updateNotionPage, appendNotionPage,
  visitLink, confirmAction,
];
