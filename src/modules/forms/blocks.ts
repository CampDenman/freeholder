// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The block types this module adds to the CMS vocabulary (MASTER.md §11, §24).
//
// Its own module rather than an export from block.tsx, because the manifest's
// loader wants a default export that is an array — the same shape `services`
// uses, for the same reason: boot validates one thing and says plainly what is
// wrong when it does not match.
import { formBlock } from "./block";

export default [formBlock];
