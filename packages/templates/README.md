# @freeholder/templates (Apache-2.0)

Business presets for Freeholder: Bench token overrides plus full page, entity
and email trees. `seed.installPreset` installs them through CMS, catalog, forms
and design services so a creator, service-business or shop instance starts with
usable seeded pages, a catalog entity and a transactional letter — not just
shape descriptors.

```ts
import { listPresets, preset } from "@freeholder/templates";

const shop = preset("shop");
shop.pages.map((page) => page.slug); // home, products, about, contact
```
