// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Which seed pack this instance installs.
//
// Photography remains the default so contributors and the SEO gate keep the
// site they already prove. Industry editions are opt-in via FREEHOLDER_EDITION
// (WeVibeSites sets that when it provisions an edition site).
import { env } from "@/core/env";
import * as photography from "./demo/content";
import * as lawFirm from "./law-firm/content";
import * as fishingCharter from "./fishing-charter/content";
import * as talent from "./talent/content";
import * as medSpa from "./med-spa/content";
import * as plasticSurgery from "./plastic-surgery/content";
import * as dental from "./dental/content";
import * as hvac from "./hvac/content";
import * as plumber from "./plumber/content";
import * as electrical from "./electrical/content";
import * as restaurant from "./restaurant/content";
import * as florist from "./florist/content";
import * as hotel from "./hotel/content";
import * as roofing from "./roofing/content";
import * as mortgage from "./mortgage/content";
import * as wealthManagement from "./wealth-management/content";
import * as groceryMarket from "./grocery-market/content";
import * as newsMedia from "./news-media/content";
import * as newspaper from "./newspaper/content";
import * as ventureCapital from "./venture-capital/content";
import * as realEstate from "./real-estate/content";
import * as generalBusiness from "./general-business/content";

export type SeedPack =
  | typeof photography
  | typeof lawFirm
  | typeof fishingCharter
  | typeof talent
  | typeof medSpa
  | typeof plasticSurgery
  | typeof dental
  | typeof hvac
  | typeof plumber
  | typeof electrical
  | typeof restaurant
  | typeof florist
  | typeof hotel
  | typeof roofing
  | typeof mortgage
  | typeof wealthManagement
  | typeof groceryMarket
  | typeof newsMedia
  | typeof newspaper
  | typeof ventureCapital
  | typeof realEstate
  | typeof generalBusiness;

export function selectedSeedPack(): SeedPack {
  switch (env().FREEHOLDER_EDITION) {
    case "law-firm":
      return lawFirm;
    case "fishing-charter":
      return fishingCharter;
    case "talent":
      return talent;
    case "med-spa":
      return medSpa;
    case "plastic-surgery":
      return plasticSurgery;
    case "dental":
      return dental;
    case "hvac":
      return hvac;
    case "plumber":
      return plumber;
    case "electrical":
      return electrical;
    case "restaurant":
      return restaurant;
    case "florist":
      return florist;
    case "hotel":
      return hotel;
    case "roofing":
      return roofing;
    case "mortgage":
      return mortgage;
    case "wealth-management":
      return wealthManagement;
    case "grocery-market":
      return groceryMarket;
    case "news-media":
      return newsMedia;
    case "newspaper":
      return newspaper;
    case "venture-capital":
      return ventureCapital;
    case "real-estate":
      return realEstate;
    case "general-business":
      return generalBusiness;
    default:
      return photography;
  }
}
