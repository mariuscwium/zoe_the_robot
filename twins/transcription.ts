/**
 * Digital twin for the transcription service (OpenAI Whisper).
 * Returns configurable transcript text for testing voice message flows.
 */

import type { TranscriptionClient } from "../lib/deps.js";

interface TranscriptionCall {
  buffer: Buffer;
  mimeType: string;
}

export class TranscriptionTwin implements TranscriptionClient {
  private transcript: string;
  private calls: TranscriptionCall[] = [];
  private shouldFail = false;

  constructor(defaultTranscript = "Hello from voice") {
    this.transcript = defaultTranscript;
  }

  transcribe(buffer: Buffer, mimeType: string): Promise<string> {
    this.calls.push({ buffer, mimeType });
    if (this.shouldFail) {
      return Promise.reject(new Error("Transcription failed"));
    }
    return Promise.resolve(this.transcript);
  }

  // --- Test helpers ---

  setTranscript(text: string): void {
    this.transcript = text;
  }

  setFail(fail: boolean): void {
    this.shouldFail = fail;
  }

  getCalls(): TranscriptionCall[] {
    return [...this.calls];
  }
}
