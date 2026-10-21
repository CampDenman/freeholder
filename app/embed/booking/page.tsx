// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C6.19: the embed and public route share the real reservation flow.
import PublicBooking from "../../(public)/book/page";
export const dynamic = "force-dynamic";
export { generateMetadata } from "../../(public)/book/page";
export default PublicBooking;
