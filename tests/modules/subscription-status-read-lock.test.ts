// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C9.33/C9.38/C12.38: parallel read-only portal statuses share identity access.
import {afterAll,beforeAll,beforeEach,describe,expect,it} from "vitest";
import {db} from "@/core/db";
import {ready} from "@/core/runtime";
import {stopJobs} from "@/core/jobs";
import {users} from "@/core/auth/schema";
import {contacts} from "@/core/contacts/schema";
import {products,productVariants} from "@/modules/catalog/schema";
import {plans,subscriptions} from "@/modules/subscriptions/schema";
import {myMerchantAmendmentStatus} from "@/modules/subscriptions/commercial-amendments";
import {myGrossProrationStatus} from "@/modules/subscriptions/proration-service";
import {closeDb,CUSTOMER,hasDatabase,truncateSpine} from "../helpers/spine";

describe.runIf(hasDatabase)("parallel own-membership status reads",()=>{
 beforeAll(ready,60000);beforeEach(truncateSpine);
 afterAll(async()=>{await stopJobs();await closeDb();});
 it("allows both own-membership status reads concurrently",async()=>{
  await db().insert(users).values({id:CUSTOMER.userId,email:"parallel-status@example.test",role:"customer"});
  const [contact]=await db().insert(contacts).values({userId:CUSTOMER.userId,email:"parallel-status@example.test",name:"Parallel status reader"}).returning();
  const [product]=await db().insert(products).values({name:"Parallel status membership",slug:"parallel-status-membership",kind:"digital"}).returning();
  const [variant]=await db().insert(productVariants).values({productId:product!.id,combinationKey:"default",sku:"parallel-status-membership",isDefault:true}).returning();
  const [plan]=await db().insert(plans).values({productId:product!.id,name:"Parallel status membership",billingMode:"manual",interval:"month"}).returning();
  const now=new Date();
  const [membership]=await db().insert(subscriptions).values({contactId:contact!.id,planId:plan!.id,productVariantId:variant!.id,currency:"CAD",billingMode:"manual",status:"paused",signupPending:true,currentPeriodStart:now,currentPeriodEnd:new Date(now.getTime()+86400000)}).returning();
  const [amendment,proration]=await Promise.all([
   myMerchantAmendmentStatus.call({id:membership!.id},CUSTOMER),
   myGrossProrationStatus.call({id:membership!.id},CUSTOMER),
  ]);
  expect(amendment).toMatchObject({commercial:false,accepted:null});
  expect(proration).toMatchObject({commercial:false,prorating:false,accepted:null});
 });
});
