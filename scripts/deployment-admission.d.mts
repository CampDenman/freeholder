// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
export function parseDeploymentOperatorRequest(value:unknown):{action:string;operationId:string;token:string;tokenHash:string;sourceRevision:string;proof?:string};
export function runDeploymentOperator(value:unknown,connection:unknown):Promise<Record<string,unknown>>;
