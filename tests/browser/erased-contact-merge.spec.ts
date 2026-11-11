// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C1.07/C1.08: real owner merge refusals with synthetic erased-state fixtures.
import AxeBuilder from "@axe-core/playwright";
import {expect,test} from "@playwright/test";
import {eq} from "drizzle-orm";
import {db,closeDb} from "@/core/db";
import {contacts,mergeCandidates,contactMergeOperations} from "@/core/contacts/schema";
import {businessProfile} from "@/core/settings/schema";
import {THEME_COOKIE} from "@/core/design/theme";
import en from "../../locales/en.json";
import es from "../../locales/es.json";
import fr from "../../locales/fr.json";
import ar from "../../locales/ar.json";
import {C11_BASE_URL,seedC11Owner,useOwnerSession} from "./owner-session";

const messages={en,es,fr,ar};
test.describe("erased contact merge cutover (C1.07/C1.08)",()=>{
 test.afterAll(closeDb);
 for(const locale of ["en","es","fr","ar"] as const){
  test(`${locale}: keeps both identities separate through ordinary and duplicate-desk merge`,async({browser})=>{
   const owner=await seedC11Owner("Erased contact merge"),text=messages[locale];
   await db().update(businessProfile).set({defaultLocale:locale,enabledLocales:["en","es","fr","ar"]}).where(eq(businessProfile.id,1));
   const [erased]=await db().insert(contacts).values({name:"Erased contact",source:"privacy-erasure"}).returning();
   const [fresh]=await db().insert(contacts).values({name:"New separate relationship",email:"separate@example.test",source:"manual"}).returning();
   const pair=[erased!,fresh!].sort((a,b)=>a.id.localeCompare(b.id));
   const [candidate]=await db().insert(mergeCandidates).values({contactAId:pair[0]!.id,contactBId:pair[1]!.id,contactAName:pair[0]!.name,contactAEmail:pair[0]!.email,contactBName:pair[1]!.name,contactBEmail:pair[1]!.email,score:50,reasons:[{code:"similar_name",points:50}]}).returning();
   const context=await browser.newContext({baseURL:C11_BASE_URL,viewport:{width:320,height:900}});
   await useOwnerSession(context,owner);const page=await context.newPage();
   try{
    for(const [survivor,duplicate] of [[fresh!,erased!],[erased!,fresh!]]){
     await page.goto(`/admin/contacts/${survivor!.id}?merge=${encodeURIComponent(duplicate!.name)}`);
     if(locale==="ar")await expect(page.locator("html")).toHaveAttribute("dir","rtl");
     const form=page.locator("form").filter({has:page.locator(`input[name="duplicateId"][value="${duplicate!.id}"]`)});
     await form.getByRole("button",{name:text["contacts.merge.submit"],exact:true}).focus();await page.keyboard.press("Enter");
     await expect(page.getByRole("alert").filter({hasText:text["contacts.merge.erased"]})).toBeVisible();
     expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
     for(const theme of ["light","dark"]){
      await context.addCookies([{name:THEME_COOKIE,value:theme,url:C11_BASE_URL}]);await page.reload();
      expect((await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze()).violations).toEqual([]);
     }
    }
    await page.goto("/admin/contacts/duplicates");
    const review=page.locator("form").filter({has:page.locator(`input[name="candidateId"][value="${candidate!.id}"]`)}).filter({has:page.locator(`input[name="survivingId"][value="${fresh!.id}"]`)});
    await review.getByRole("button").click();
    await expect(page.getByRole("alert").filter({hasText:text["contacts.merge.erased"]})).toBeVisible();
    expect((await db().select().from(mergeCandidates).where(eq(mergeCandidates.id,candidate!.id)))[0]!.status).toBe("open");
    expect(await db().select().from(contactMergeOperations)).toHaveLength(0);
    expect((await db().select().from(contacts).where(eq(contacts.id,erased!.id)))[0]!.source).toBe("privacy-erasure");
    expect((await db().select().from(contacts).where(eq(contacts.id,fresh!.id)))[0]!.email).toBe("separate@example.test");
   }finally{await context.close();}
  });
 }
});
