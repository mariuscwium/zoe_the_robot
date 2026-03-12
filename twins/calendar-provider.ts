/**
 * Digital twin: CalendarProvider.
 * Wraps a CalendarTwin to simulate per-member OAuth access.
 * By default all members share the same CalendarTwin instance.
 */

import type { CalendarClient, CalendarProvider } from "../lib/deps.js";
import { CalendarTwin } from "./calendar.js";

export class CalendarProviderTwin implements CalendarProvider {
  private authorized = new Map<string, CalendarClient>();
  private sharedTwin: CalendarTwin;
  private allAuthorized: boolean;

  constructor(sharedTwin?: CalendarTwin, allAuthorized = true) {
    this.sharedTwin = sharedTwin ?? new CalendarTwin();
    this.allAuthorized = allAuthorized;
  }

  getClient(memberId: string): Promise<CalendarClient | null> {
    const explicit = this.authorized.get(memberId);
    if (explicit) return Promise.resolve(explicit);
    if (this.allAuthorized) return Promise.resolve(this.sharedTwin);
    return Promise.resolve(null);
  }

  /** Grant a specific member access (optionally with a custom twin). */
  authorize(memberId: string, client?: CalendarClient): void {
    this.authorized.set(memberId, client ?? this.sharedTwin);
  }

  /** Revoke a member's access (simulates token deletion). */
  revoke(memberId: string): void {
    this.authorized.delete(memberId);
    this.allAuthorized = false;
  }

  /** Get the shared CalendarTwin for direct assertions. */
  getSharedTwin(): CalendarTwin {
    return this.sharedTwin;
  }

  reset(): void {
    this.authorized.clear();
    this.sharedTwin.reset();
    this.allAuthorized = true;
  }
}
