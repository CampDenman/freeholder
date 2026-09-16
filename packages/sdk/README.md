# @freeholder/sdk

The typed ESM client for a Freeholder instance's versioned HTTP service
surface. Methods and input/output types are generated from the same live
service registry that produces OpenAPI and MCP tools. Create a client with an
instance URL and, for protected services, an API key.

```ts
import { createClient } from "@freeholder/sdk";

const client = createClient({
  baseUrl: "https://studio.example",
  token: process.env.FREEHOLDER_API_KEY,
});

const page = await client.api.contacts.list({ limit: 25 });
const created = await client.call("contacts.create", {
  name: "Ada Lovelace",
  email: "ada@example.com",
});

for await (const contact of client.paginate("contacts.list", { limit: 50 })) {
  console.log(contact.name);
}
```

`call(name, input)` POSTs `/api/v1/<name>`. Namespaced `api.<family>.<verb>`
methods are the same POST with generated types. Instance-specific plugin verbs
that are not in the published catalog still go through `call`. Errors are
returned as `FreeholderError` values with HTTP status and stable service error
code fields.

The package contains compiled JavaScript and declarations. Its version is kept
in lockstep with the platform and is verified from a packed, clean install.
Regenerate types after a registry change with `pnpm sdk:generate`.
