// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The interface vocabulary. Small, owned, and free of framework imports — the
// §10 boundary applies here too, so these render the same under any React
// host and a framework migration is a chore in app/ rather than a rewrite.
//
// Everything styles through the token utilities (bg-surface, text-ink-muted,
// border-rule…), never a literal colour. That is what lets an owner's brand
// reach every component at once (§32), and what keeps the platform's chrome
// from competing with the business it hosts.
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ---------------------------------------------------------------- surfaces */

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "overflow-hidden rounded-lg border border-rule bg-surface",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  icon,
  title,
  status,
}: {
  icon?: ReactNode;
  title: string;
  status?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 border-b border-rule bg-surface-muted px-4 py-3">
      {icon ? <span className="text-accent">{icon}</span> : null}
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {status ? <div className="ms-auto">{status}</div> : null}
    </div>
  );
}

export function CardBody({ children }: { children: ReactNode }) {
  return <div className="grid gap-5 px-4 py-5">{children}</div>;
}

export function CardFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-rule bg-surface-muted px-4 py-3.5">
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ status */

const TONES = {
  neutral: "bg-surface-muted text-ink-muted",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  accent: "bg-accent-soft text-accent",
} as const;

export type Tone = keyof typeof TONES;

export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
        TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

/**
 * A message about the whole form. Carries an icon slot rather than colour
 * alone, because colour is not available to every reader (§15.7).
 */
export function Callout({
  tone = "neutral",
  icon,
  children,
}: {
  tone?: Tone;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : undefined}
      className={cx(
        "flex items-start gap-2.5 rounded-md px-3.5 py-3 text-sm",
        TONES[tone],
      )}
    >
      {icon ? <span className="mt-0.5 shrink-0">{icon}</span> : null}
      <div className="[&_a]:underline">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------- forms */

/**
 * Label, control, hint and error as one unit — so a field can never ship
 * without its label, and an error is always announced with the input it
 * belongs to.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  return (
    <div className="grid gap-1.5">
      <label
        htmlFor={htmlFor}
        className="font-mono text-xs font-medium text-ink-muted"
      >
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p id={hintId} className="text-xs text-ink-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const CONTROL =
  "w-full rounded-md border border-rule bg-field px-3 py-2 text-sm text-ink " +
  "placeholder:text-ink-muted focus-visible:border-accent";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props;
  return <input {...rest} className={cx(CONTROL, className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { className, children, ...rest } = props;
  // A native select on purpose: it is keyboard- and screen-reader-correct for
  // free, renders as the platform picker on a phone, and works before any
  // JavaScript has loaded — which matters most on the very first screen.
  return (
    <select {...rest} className={cx(CONTROL, "appearance-none pe-8", className)}>
      {children}
    </select>
  );
}

/**
 * A small, mutually exclusive choice — metric or imperial, on or off. Radio
 * inputs under the styling, so arrow keys and screen readers behave without
 * any script.
 */
export function Segmented({
  name,
  options,
  defaultValue,
}: {
  name: string;
  options: Array<{ value: string; label: string }>;
  defaultValue: string;
}) {
  return (
    <div
      role="radiogroup"
      className="inline-flex overflow-hidden rounded-md border border-rule"
    >
      {options.map((option) => (
        <label
          key={option.value}
          className="cursor-pointer border-e border-rule text-sm last:border-e-0 has-[:checked]:bg-accent has-[:checked]:font-semibold has-[:checked]:text-on-accent"
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            defaultChecked={option.value === defaultValue}
            className="sr-only"
          />
          <span className="block px-4 py-2 text-ink-muted has-[:checked]:text-on-accent">
            {option.label}
          </span>
        </label>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- actions */

const VARIANTS = {
  primary: "bg-accent text-on-accent shadow-[inset_0_-2px_0_rgb(0_0_0/0.16)]",
  quiet: "border border-rule bg-transparent text-ink-muted",
  danger: "bg-danger text-white",
} as const;

export function Button({
  variant = "primary",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof VARIANTS;
}) {
  return (
    <button
      {...rest}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2",
        "text-sm font-semibold disabled:opacity-55",
        VARIANTS[variant],
        className,
      )}
    />
  );
}
