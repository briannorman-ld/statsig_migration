import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONCIERGE_NUMBER, ReverseMigrationScreen } from './ReverseMigration.tsx';

/**
 * Walks the whole prank flow end to end. The important assertions: the identity answers are
 * wiped the moment the step is submitted, and the only way out at the end is a phone number.
 */
describe('ReverseMigrationScreen', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // Each step chains timers through state and effects, and React flushes effects only when an
  // act() ends, so advance in small slices rather than one jump.
  const tick = (ms: number) => {
    for (let t = 0; t < ms; t += 50) act(() => vi.advanceTimersByTime(50));
  };
  const button = (name: string | RegExp) => screen.getByRole('button', { name });
  const click = (name: string | RegExp) => fireEvent.click(button(name));

  it('takes fourteen steps to arrive at a phone number', () => {
    const onExit = vi.fn();
    render(<ReverseMigrationScreen onExit={onExit} />);

    // 1. Welcome. The step counter under-reports the total on purpose.
    expect(screen.getByText(/Step 1 of ~4/)).toBeTruthy();
    click('Begin reverse migration');

    // 2. Eligibility checks reveal one at a time; the button waits for the last.
    expect((button('Checking…') as HTMLButtonElement).disabled).toBe(true);
    tick(400 + 1400 * 6);
    expect(screen.getByText('You are eligible to migrate. Unfortunately.')).toBeTruthy();
    click('Continue anyway');

    // 3. Reason: a reason, sixty characters, and a second opinion.
    fireEvent.click(screen.getByLabelText('I lost a bet'));
    expect((button('Continue') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Tell us more/), { target: { value: 'x'.repeat(60) } });
    click('Continue');
    expect(screen.getByText(/really the reason/)).toBeTruthy();
    click('Yes');
    click('Continue');

    // 4. Terms: scroll to the end, then three checkboxes in order.
    const first = screen.getByLabelText(/I have read the Terms/) as HTMLInputElement;
    expect(first.disabled).toBe(true);
    fireEvent.scroll(screen.getByText('1. Definitions').parentElement!.parentElement!);
    fireEvent.click(first);
    fireEvent.click(screen.getByLabelText(/actually read them/));
    fireEvent.click(screen.getByLabelText(/section 7\(b\)/));
    click('Accept and continue');

    // 5. Identity: six absurd questions. Typing marks them answered; nothing is kept.
    const fields = screen.getAllByPlaceholderText('••••••••') as HTMLInputElement[];
    expect(fields).toHaveLength(6);
    expect(fields.every((f) => f.type === 'password' && f.autocomplete === 'off')).toBe(true);
    for (const f of fields) fireEvent.change(f, { target: { value: 'not kept' } });
    expect(screen.getAllByText('✓ answered')).toHaveLength(6);
    click('Verify');
    expect(fields.every((f) => f.value === '')).toBe(true); // wiped before "verifying" even starts
    tick(2600);
    expect(screen.getByText('We could not verify any of that. Continuing.')).toBeTruthy();
    click('Continue');

    // 6. Inventory fails at 83% the first time.
    tick(400 + 900 * 9);
    expect(screen.getByText(/E_PACKET_TOO_EMOTIONAL/)).toBeTruthy();
    click('Retry');
    tick(400 + 650 * 5);
    click('Continue');

    // 7. Plan: a tier and a cadence.
    fireEvent.click(screen.getByLabelText(/Pro/));
    fireEvent.change(screen.getByLabelText('Billing cadence'), { target: { value: 'monthly' } });
    click('Continue');

    // 8. Seven decisions, each "recorded" with a delay.
    for (let i = 0; i < 7; i++) {
      expect(screen.getByText(`${i} of 7 resolved`)).toBeTruthy();
      fireEvent.click(screen.getAllByRole('button').find((b) => b.closest('.bg-warning-bg') && !b.textContent?.startsWith('Why'))!);
      tick(1300);
    }
    expect(screen.getByText(/All seven decisions recorded/)).toBeTruthy();
    click('Continue');

    // 9. The captcha has no right answer; two tries make you human.
    const tiles = () => screen.getAllByRole('button', { pressed: false }).filter((b) => b.closest('[aria-label="Tiles"]'));
    fireEvent.click(tiles()[0]!);
    click('Verify');
    expect(screen.getByText('Incorrect. Please try again.')).toBeTruthy();
    fireEvent.click(tiles()[0]!);
    click('Verify');
    expect(screen.getByText(/clearly human/)).toBeTruthy();
    click('Continue');

    // 10. The third cutover window is grudgingly accepted.
    fireEvent.change(screen.getByLabelText('Time zone'), { target: { value: 'UTC' } });
    for (let i = 0; i < 3; i++) {
      fireEvent.change(screen.getByLabelText('Date and time'), { target: { value: '2031-02-28T14:02' } });
      click('Request this window');
      tick(1200);
    }
    expect(screen.getByText(/Someone will probably be around/)).toBeTruthy();
    click('Continue');

    // 11. Survey: a low score is taken personally.
    fireEvent.click(screen.getByRole('radio', { name: '3' }));
    expect(screen.getByText(/That is hurtful/)).toBeTruthy();
    click('No');
    fireEvent.change(screen.getByLabelText(/What could we have done better/), { target: { value: 'the wizard' } });
    click('Submit and join the queue');

    // 12. The queue counts down, bumps once, and connects on its own.
    expect(screen.getByText('4,218')).toBeTruthy();
    tick(30_000);
    expect(screen.getByText('Final confirmation', { selector: 'h2' })).toBeTruthy();

    // 13. The phrase must match exactly.
    const phrase = screen.getByLabelText('Confirmation phrase');
    fireEvent.change(phrase, { target: { value: 'i would like to migrate to statsig.' } });
    expect(screen.getByText('Case matters to us.')).toBeTruthy();
    fireEvent.change(phrase, { target: { value: 'I would like to migrate to StatSig' } });
    expect(screen.getByText('Close. Punctuation matters to us.')).toBeTruthy();
    fireEvent.change(phrase, { target: { value: 'I would like to migrate to StatSig.' } });
    click('Complete migration');

    // 14. The hotline.
    expect(screen.getByText(/Step 14 of 14/)).toBeTruthy();
    const tel = screen.getByRole('link', { name: new RegExp(CONCIERGE_NUMBER) }) as HTMLAnchorElement;
    expect(tel.href).toBe('tel:6054773018');
    expect(screen.getByText(/nothing you typed into it was kept/)).toBeTruthy();
    click(/stay with LaunchDarkly/);
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
