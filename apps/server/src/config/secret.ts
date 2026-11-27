import { inspect } from 'node:util';

const shown = '[secret]';

/**
 * Wraps a credential so that logging, serialising or inspecting the config never shows it.
 * Only the adapter that sends the credential calls `reveal()`.
 */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return shown;
  }

  toJSON(): string {
    return shown;
  }

  [inspect.custom](): string {
    return shown;
  }
}
