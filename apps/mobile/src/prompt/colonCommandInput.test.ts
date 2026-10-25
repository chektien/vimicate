import { describe, expect, it } from 'vitest';
import { colonCommandInput } from './colonCommandInput';

describe('single-line colon command admission', () => {
  it.each([':diagnostics', ':new', ':model openai/example', ':reload_projects', ':unknown argument'])(
    'keeps an explicit command for local/remote validation: %s', input => {
      expect(colonCommandInput(`  ${input}  `)).toBe(input);
    },
  );
  it.each(['\n', '\r\n', '\r', '\u2028', '\u2029'])(
    'keeps pasted multiline output literal across line separator %j', newline => {
      expect(colonCommandInput(`:diagnostics — retained fatal breadcrumb${newline}at=1789888492883`)).toBeNull();
      expect(colonCommandInput(`:new${newline}`)).toBeNull();
    },
  );
  it.each(['ordinary text', ':', '::selection { color: red; }', ':hover { color: red; }\nbutton { }'])(
    'does not claim ordinary prose/code %s', input => expect(colonCommandInput(input)).toBeNull(),
  );
});
