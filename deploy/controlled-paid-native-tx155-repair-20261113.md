<!-- Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0 -->
# Genuine paid-period native reader transactions

C9.33/C12.38/C1.08. SOURCE ONLY, all controls UNRUN. Root's v61 compiler found
that the native outer service lacked the required summary, erasing the expected
service result, and reader calls passed the database handle instead of a real
transaction. This narrow test-only successor adds the meaningful service summary
and puts the related invoice/subject/refund/merchant footprint and safe export
comparisons inside one actual db().transaction. Post-contact-merge witness/export
comparisons run in a second genuine transaction after the actual merge commits.
No Tx cast, fake ServiceContext, guard, model, SQL, production source, timeout or
assertion is changed. Actual source/native qualification remains required.
