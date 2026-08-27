// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Why a person-to-person message is being sent (MASTER.md §4.14).

/**
 * Consent and delivery policy follow the purpose, not the screen that happened
 * to send. Keeping this vocabulary in one file prevents numbers, messages and
 * the send boundary from growing subtly different answers.
 */
export const MESSAGE_PURPOSES = ["transactional", "marketing", "support"] as const;

export type MessagePurpose = (typeof MESSAGE_PURPOSES)[number];
