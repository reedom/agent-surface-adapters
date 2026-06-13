import { describe, expect, it } from 'vitest';
import { launcherScript, shellQuote } from '../src/core/launcher.js';

describe('shellQuote', () => {
  it('single-quotes and escapes embedded single quotes', () => {
    expect(shellQuote("a b")).toBe("'a b'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });
});

describe('launcherScript', () => {
  it('produces a bash exec line with every arg quoted', () => {
    const s = launcherScript('claude', ['--session-id', 's', '--', "it's done"]);
    expect(s.startsWith('#!/usr/bin/env bash\n')).toBe(true);
    expect(s).toContain("exec 'claude' '--session-id' 's' '--' 'it'\\''s done'");
  });
});
