// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Recipe inventory used by the C3.16–C3.17 matrix.
import { TIER1_TARGETS, RECIPE_OPERATIONS } from "@/core/portability/archive";

export const TIER1_RECIPES = TIER1_TARGETS;
export { RECIPE_OPERATIONS };

export const REQUIRED_RECIPE_FILES = [
  "recipe.yaml",
  "README.md",
  "verify.md",
  "migrate.md",
  ".env.example",
] as const;
