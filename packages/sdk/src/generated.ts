// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Generated from the live service registry (MASTER.md §28, C3.03).
// Do not edit. Regenerate with `pnpm sdk:generate`.

export const SERVICE_NAMES = [
  "ads.addSize",
  "ads.adsTxt",
  "ads.advertisers",
  "ads.campaignReport",
  "ads.campaigns",
  "ads.creatives",
  "ads.decideCampaign",
  "ads.deleteTxtEntry",
  "ads.ensureSizes",
  "ads.invoiceCampaign",
  "ads.lineItems",
  "ads.reconcileCampaign",
  "ads.recordBeacon",
  "ads.recordClick",
  "ads.reviewCreative",
  "ads.saveAdvertiser",
  "ads.saveCampaign",
  "ads.saveCreative",
  "ads.saveLineItem",
  "ads.saveSlot",
  "ads.saveTxtEntry",
  "ads.serve",
  "ads.setCampaignStatus",
  "ads.sizes",
  "ads.slotByCode",
  "ads.slots",
  "ads.txtEntries",
  "agents.approveWrite",
  "agents.assignTask",
  "agents.board",
  "agents.cancelTask",
  "agents.claimTask",
  "agents.completeTask",
  "agents.connect",
  "agents.connections",
  "agents.createPlaybook",
  "agents.createTask",
  "agents.deletePlaybook",
  "agents.expireApprovals",
  "agents.exportPlaybook",
  "agents.flagTask",
  "agents.hire",
  "agents.importPlaybook",
  "agents.inspectRun",
  "agents.list",
  "agents.listApprovals",
  "agents.pause",
  "agents.pauseAll",
  "agents.playbook",
  "agents.playbooks",
  "agents.proposeWrite",
  "agents.rejectWrite",
  "agents.releaseTask",
  "agents.reopenTask",
  "agents.reportStep",
  "agents.retryTask",
  "agents.runPlaybook",
  "agents.setPlaybookSchedule",
  "agents.spend",
  "agents.stopRun",
  "agents.tailRun",
  "agents.task",
  "agents.tasks",
  "agents.update",
  "agents.updatePlaybook",
  "agents.updateTask",
  "analytics.campaignAttribution",
  "analytics.campaignTotals",
  "analytics.classificationCandidates",
  "analytics.contactActivity",
  "analytics.correctClassification",
  "analytics.daily",
  "analytics.experimentReport",
  "analytics.exportAnonymized",
  "analytics.funnel",
  "analytics.funnelDefinitions",
  "analytics.identify",
  "analytics.overview",
  "analytics.recordExperimentConversion",
  "analytics.recordExperimentImpressions",
  "analytics.recordWebVital",
  "analytics.topPages",
  "analytics.topReferrers",
  "analytics.track",
  "analytics.webVitals",
  "apikeys.create",
  "apikeys.list",
  "apikeys.revoke",
  "apikeys.scopes",
  "assistant.answer",
  "assistant.deleteKnowledge",
  "assistant.dismissGap",
  "assistant.knowledgeGapList",
  "assistant.knowledgeList",
  "assistant.reindex",
  "assistant.saveGapAsKnowledge",
  "assistant.saveKnowledge",
  "assistant.scopes",
  "assistant.setScope",
  "assistant.settings",
  "assistant.turns",
  "assistant.updateSettings",
  "audiences.create",
  "audiences.link",
  "audiences.list",
  "audiences.remove",
  "audiences.rotateLink",
  "audiences.setCalendars",
  "audiences.setHours",
  "audiences.setServices",
  "auth.beginTotpEnrollment",
  "auth.beginWebAuthnRegistration",
  "auth.beginWebAuthnStepUp",
  "auth.changePassword",
  "auth.completeTwoFactorLogin",
  "auth.completeWebAuthnLogin",
  "auth.confirmTotpEnrollment",
  "auth.consumeCustomerMagicLink",
  "auth.finishWebAuthnRegistration",
  "auth.finishWebAuthnStepUp",
  "auth.listSessions",
  "auth.login",
  "auth.loginChallengeDetails",
  "auth.logout",
  "auth.recentLoginSecurity",
  "auth.regenerateRecoveryCodes",
  "auth.registerOwner",
  "auth.removeTotpFactor",
  "auth.removeWebAuthnFactor",
  "auth.requestCustomerMagicLink",
  "auth.requestPasswordReset",
  "auth.resetPassword",
  "auth.revokeOtherSessions",
  "auth.revokeSession",
  "auth.twoFactorStatus",
  "auth.verifyStepUpCode",
  "auth.whoami",
  "automations.checkGuardrails",
  "automations.get",
  "automations.inspectRun",
  "automations.killRun",
  "automations.list",
  "automations.publish",
  "automations.restoreVersion",
  "automations.run",
  "automations.runs",
  "automations.save",
  "automations.setStatus",
  "automations.triggers",
  "automations.validate",
  "automations.verbs",
  "automations.versionGraph",
  "automations.versions",
  "availability.addException",
  "availability.copyDay",
  "availability.removeException",
  "availability.rules",
  "availability.setRules",
  "availability.windows",
  "bookings.addParticipant",
  "bookings.addReminder",
  "bookings.attachIntake",
  "bookings.attachIntakeByToken",
  "bookings.byToken",
  "bookings.cancelByToken",
  "bookings.cancelReminder",
  "bookings.create",
  "bookings.get",
  "bookings.ics",
  "bookings.issueWaiver",
  "bookings.list",
  "bookings.reminders",
  "bookings.removeParticipant",
  "bookings.requirements",
  "bookings.reschedule",
  "bookings.rescheduleByToken",
  "bookings.setParticipantStatus",
  "bookings.setStatus",
  "briefing.markRead",
  "briefing.recent",
  "briefing.setSection",
  "briefing.today",
  "broadcasts.list",
  "broadcasts.pause",
  "broadcasts.recipients",
  "broadcasts.resume",
  "broadcasts.save",
  "broadcasts.start",
  "broadcasts.stats",
  "broadcasts.testSend",
  "builder.apply",
  "builder.codeStatus",
  "builder.deliverCode",
  "builder.getCodeProposal",
  "builder.getProposal",
  "builder.listCodeProposals",
  "builder.listProposals",
  "builder.propose",
  "builder.proposeCode",
  "builder.reject",
  "builder.rejectCode",
  "builder.rollback",
  "builder.status",
  "calendars.archive",
  "calendars.create",
  "calendars.feed",
  "calendars.forService",
  "calendars.get",
  "calendars.issueFeed",
  "calendars.list",
  "calendars.revokeFeed",
  "calendars.setForService",
  "calendars.setIcsImport",
  "calendars.update",
  "catalog.abandonStaleCarts",
  "catalog.activateProduct",
  "catalog.addBundleComponent",
  "catalog.addCartItem",
  "catalog.addOptionValue",
  "catalog.addProductRelation",
  "catalog.addPurchaseOrderLine",
  "catalog.addShippingRateBand",
  "catalog.addWishlistItem",
  "catalog.adjustStock",
  "catalog.applyCouponToCart",
  "catalog.applyGiftCardToInvoice",
  "catalog.applyVariantMatrix",
  "catalog.archiveProduct",
  "catalog.assignProductOption",
  "catalog.attachCartToContact",
  "catalog.attachProductMedia",
  "catalog.availability",
  "catalog.bookingRequirements",
  "catalog.bookingTerms",
  "catalog.cancelOrder",
  "catalog.cancelPurchaseOrder",
  "catalog.checkoutCart",
  "catalog.compareProducts",
  "catalog.consumeReservation",
  "catalog.countStock",
  "catalog.createAttributeDefinition",
  "catalog.createCancellationPolicy",
  "catalog.createCoupon",
  "catalog.createCustomerGroup",
  "catalog.createDeliveryWindow",
  "catalog.createFulfillment",
  "catalog.createOfferRule",
  "catalog.createOptionType",
  "catalog.createPackagingBox",
  "catalog.createPriceList",
  "catalog.createProduct",
  "catalog.createPurchaseOrder",
  "catalog.createShippingMethod",
  "catalog.createShippingZone",
  "catalog.createSupplier",
  "catalog.decideReturn",
  "catalog.deleteCancellationPolicy",
  "catalog.deliverFulfillment",
  "catalog.detachProductMedia",
  "catalog.enableInventory",
  "catalog.expireReservations",
  "catalog.failFulfillment",
  "catalog.filterProductsByAttribute",
  "catalog.getCart",
  "catalog.getFulfillment",
  "catalog.getOrCreateCart",
  "catalog.getOrder",
  "catalog.getProduct",
  "catalog.getProductVariants",
  "catalog.getReturn",
  "catalog.getServiceOffering",
  "catalog.giftCardByShareToken",
  "catalog.grantDigitalFulfillment",
  "catalog.issueGiftCard",
  "catalog.listAttributeDefinitions",
  "catalog.listBundleComponents",
  "catalog.listCancellationPolicies",
  "catalog.listCartOffers",
  "catalog.listCarts",
  "catalog.listCoupons",
  "catalog.listCustomerGroups",
  "catalog.listDigitalDeliveries",
  "catalog.listFulfillmentQueue",
  "catalog.listFulfillments",
  "catalog.listGiftCards",
  "catalog.listInventory",
  "catalog.listOfferRules",
  "catalog.listOptionTypes",
  "catalog.listOrders",
  "catalog.listPriceLists",
  "catalog.listPriceRules",
  "catalog.listProductAttributes",
  "catalog.listProductMedia",
  "catalog.listProductRelations",
  "catalog.listProducts",
  "catalog.listPurchaseOrders",
  "catalog.listReorderQueue",
  "catalog.listReservations",
  "catalog.listReturns",
  "catalog.listSavedCarts",
  "catalog.listSellableVariants",
  "catalog.listShippingCatalog",
  "catalog.listShippingZones",
  "catalog.listStockMovements",
  "catalog.listSuppliers",
  "catalog.listTaxCategories",
  "catalog.listTrackedVariantChoices",
  "catalog.listVisibleProducts",
  "catalog.listWishlist",
  "catalog.loadDemoFixture",
  "catalog.packFulfillment",
  "catalog.payOrder",
  "catalog.placePurchaseOrder",
  "catalog.publishProduct",
  "catalog.purgeDemoFixture",
  "catalog.quoteBundle",
  "catalog.quoteCartPromotions",
  "catalog.quoteServicePayment",
  "catalog.quoteShipping",
  "catalog.receivePurchaseOrderLine",
  "catalog.receiveReturn",
  "catalog.recordCouponRedemption",
  "catalog.recordDamage",
  "catalog.recordStockMovement",
  "catalog.recoverAbandonedCarts",
  "catalog.refundReturn",
  "catalog.releaseReservation",
  "catalog.removeBundleComponent",
  "catalog.removeCartItem",
  "catalog.removePriceRule",
  "catalog.removeProductRelation",
  "catalog.removeWishlistItem",
  "catalog.requestReturn",
  "catalog.reserveStock",
  "catalog.resolvePrice",
  "catalog.resolveVisibleProduct",
  "catalog.restoreProduct",
  "catalog.revokeWishlistShare",
  "catalog.saveCart",
  "catalog.sendGiftCard",
  "catalog.setCartItemQuantity",
  "catalog.setDefaultVariant",
  "catalog.setInventoryLevels",
  "catalog.setPriceBreak",
  "catalog.setPriceListEntry",
  "catalog.setPriceRule",
  "catalog.setProductAttribute",
  "catalog.setProductOptionValues",
  "catalog.setVariantStockPolicy",
  "catalog.shareWishlist",
  "catalog.shipFulfillment",
  "catalog.subscribeBackInStock",
  "catalog.transferStock",
  "catalog.updateProduct",
  "catalog.updateProductDescription",
  "catalog.upsertServiceOffering",
  "catalog.verifyDemoFixture",
  "catalog.wishlistByShareToken",
  "catalogue.addSource",
  "catalogue.install",
  "catalogue.installs",
  "catalogue.list",
  "catalogue.preview",
  "catalogue.refresh",
  "catalogue.removeSource",
  "catalogue.sources",
  "cms.addComment",
  "cms.applyDueSchedules",
  "cms.attachLayout",
  "cms.compareRevisions",
  "cms.createFromTemplate",
  "cms.createPage",
  "cms.createPreviewLink",
  "cms.createSection",
  "cms.createSectionLocale",
  "cms.decideApproval",
  "cms.decideReview",
  "cms.deleteDraftPage",
  "cms.deleteHelpCategory",
  "cms.deleteSection",
  "cms.describeConflict",
  "cms.detachLayout",
  "cms.detachSection",
  "cms.draftPageTranslation",
  "cms.ensureDefaults",
  "cms.ensureTemplates",
  "cms.expireStalePresence",
  "cms.fileHelpArticle",
  "cms.getLayout",
  "cms.getPage",
  "cms.getSection",
  "cms.getTemplate",
  "cms.heartbeatPresence",
  "cms.helpArticleAt",
  "cms.helpArticleFeedback",
  "cms.helpArticles",
  "cms.helpCategories",
  "cms.leavePresence",
  "cms.listComments",
  "cms.listPages",
  "cms.listPresence",
  "cms.listPreviewLinks",
  "cms.listRevisions",
  "cms.listSectionUsages",
  "cms.listSections",
  "cms.listTemplates",
  "cms.loadDemoFixture",
  "cms.mergePage",
  "cms.nameRevision",
  "cms.pageAccessibilityReport",
  "cms.pageAuthorSummary",
  "cms.pageTranslationReport",
  "cms.previewEmail",
  "cms.previewSms",
  "cms.previewTemplate",
  "cms.publishPage",
  "cms.publishedPaths",
  "cms.purgeDemoFixture",
  "cms.rateHelpArticle",
  "cms.rejoinLayout",
  "cms.releaseEditLease",
  "cms.reloadWorkingDraft",
  "cms.reopenThread",
  "cms.requestApproval",
  "cms.requestReview",
  "cms.resetTemplate",
  "cms.resolvePage",
  "cms.resolvePreviewLink",
  "cms.resolveThread",
  "cms.restoreRevision",
  "cms.revokePreviewLink",
  "cms.saveAsSection",
  "cms.saveHelpCategory",
  "cms.schedulePage",
  "cms.searchHelp",
  "cms.sendSmsTemplate",
  "cms.snapshotRevision",
  "cms.submitQuoteRequest",
  "cms.submitSiteChat",
  "cms.submitTipIntent",
  "cms.testSendEmail",
  "cms.testSendSms",
  "cms.touchEditLease",
  "cms.updatePage",
  "cms.updateSection",
  "cms.updateTemplate",
  "cms.verifyDemoFixture",
  "community.createSpace",
  "community.getBySlug",
  "community.join",
  "community.joinBySlug",
  "community.listMembers",
  "community.listSpaces",
  "connections.beginCalendarOAuth",
  "connections.beginMailReadOAuth",
  "connections.busyWindows",
  "connections.calendarSources",
  "connections.completeCalendarOAuth",
  "connections.completeMailReadOAuth",
  "connections.flag",
  "connections.grantToAgent",
  "connections.grants",
  "connections.importMail",
  "connections.list",
  "connections.listCalendars",
  "connections.mine",
  "connections.record",
  "connections.remove",
  "connections.revokeFromAgent",
  "connections.rotateCredentials",
  "connections.setCalendarRole",
  "connections.setCapability",
  "connections.setOptions",
  "connections.syncCalendars",
  "contactImports.begin",
  "contactImports.commit",
  "contactImports.get",
  "contactImports.list",
  "contactImports.map",
  "contactImports.revert",
  "contacts.addPrivacyRetentionException",
  "contacts.canContact",
  "contacts.create",
  "contacts.createCustomField",
  "contacts.createDataRequest",
  "contacts.createOrganization",
  "contacts.createRelationship",
  "contacts.deleteOrganization",
  "contacts.deleteRelationship",
  "contacts.denyDataRequest",
  "contacts.dismissDuplicateCandidate",
  "contacts.downloadDataRequestArtifact",
  "contacts.fulfillDataRequest",
  "contacts.get",
  "contacts.getConsentPreferences",
  "contacts.getDataRequest",
  "contacts.getOrganization",
  "contacts.list",
  "contacts.listCustomFields",
  "contacts.listDataRequests",
  "contacts.listDuplicateCandidates",
  "contacts.listMergeOperations",
  "contacts.listOrganizations",
  "contacts.listRelationships",
  "contacts.listTags",
  "contacts.merge",
  "contacts.mergeDuplicateCandidate",
  "contacts.recordConsent",
  "contacts.removePrivacyRetentionException",
  "contacts.resolve",
  "contacts.scanDuplicates",
  "contacts.startDataRequest",
  "contacts.stats",
  "contacts.timeline",
  "contacts.undoMerge",
  "contacts.update",
  "contacts.updateCustomField",
  "contacts.updateOrganization",
  "contacts.updateRelationship",
  "contacts.verifyDataRequest",
  "contracts.archiveTemplate",
  "contracts.byToken",
  "contracts.countersign",
  "contracts.decline",
  "contracts.export",
  "contracts.get",
  "contracts.issue",
  "contracts.issueFromTemplate",
  "contracts.list",
  "contracts.listTemplates",
  "contracts.previewTemplate",
  "contracts.saveTemplate",
  "contracts.sign",
  "contracts.signedFor",
  "contracts.signingLink",
  "contracts.void",
  "contribute.attach",
  "contribute.determine",
  "contribute.draft",
  "contribute.get",
  "contribute.getSettings",
  "contribute.hubStatus",
  "contribute.ingest",
  "contribute.list",
  "contribute.recordStatus",
  "contribute.setHubEnabled",
  "contribute.submit",
  "contribute.triage",
  "contribute.updateSettings",
  "conversations.assign",
  "conversations.bulk",
  "conversations.counts",
  "conversations.get",
  "conversations.list",
  "conversations.markRead",
  "conversations.record",
  "conversations.recordDelivery",
  "conversations.reply",
  "conversations.search",
  "conversations.setStatus",
  "conversations.snooze",
  "core.loadDemoBookings",
  "core.loadDemoContacts",
  "core.loadDemoInbox",
  "core.loadDemoLocations",
  "core.purgeDemoBookings",
  "core.purgeDemoContacts",
  "core.purgeDemoInbox",
  "core.purgeDemoLocations",
  "core.verifyDemoBookings",
  "core.verifyDemoContacts",
  "core.verifyDemoInbox",
  "core.verifyDemoLocations",
  "crm.createDeal",
  "crm.installDefaults",
  "crm.lifecycleBoard",
  "crm.listDeals",
  "crm.listPipelines",
  "crm.moveContactStage",
  "crm.moveDeal",
  "crm.removeStage",
  "crm.savePipeline",
  "crm.saveStage",
  "crm.updateDeal",
  "demo.install",
  "demo.list",
  "demo.load",
  "demo.purge",
  "demo.reload",
  "demo.reset",
  "documents.addVersion",
  "documents.export",
  "documents.history",
  "documents.list",
  "documents.open",
  "documents.revokeShare",
  "documents.save",
  "documents.share",
  "documents.shares",
  "documents.versions",
  "entitlements.grant",
  "entitlements.hasAccess",
  "entitlements.list",
  "entitlements.listGrants",
  "entitlements.revoke",
  "entitlements.save",
  "entitlements.spendPass",
  "events.addSession",
  "events.addTicket",
  "events.calendar",
  "events.cancel",
  "events.cancelRegistration",
  "events.checkIn",
  "events.create",
  "events.get",
  "events.list",
  "events.listPublic",
  "events.publish",
  "events.recentActivity",
  "events.register",
  "events.resolvePublic",
  "events.update",
  "forms.byId",
  "forms.create",
  "forms.delete",
  "forms.get",
  "forms.list",
  "forms.listSubmissions",
  "forms.loadDemoFixture",
  "forms.purgeDemoFixture",
  "forms.reviewSubmission",
  "forms.submissionCounts",
  "forms.submit",
  "forms.update",
  "forms.verifyDemoFixture",
  "galleries.addItem",
  "galleries.addPriceSheetItem",
  "galleries.addToCart",
  "galleries.approveRound",
  "galleries.archiveState",
  "galleries.clearSelection",
  "galleries.create",
  "galleries.downloadArchive",
  "galleries.downloadItem",
  "galleries.get",
  "galleries.inviteGuest",
  "galleries.invitePartner",
  "galleries.list",
  "galleries.listAccess",
  "galleries.listGuests",
  "galleries.listPriceSheet",
  "galleries.listRounds",
  "galleries.listSelections",
  "galleries.loadDemoFixture",
  "galleries.openWithLogin",
  "galleries.publicBySlug",
  "galleries.purgeDemoFixture",
  "galleries.redeemGuest",
  "galleries.removeItem",
  "galleries.removePriceSheetItem",
  "galleries.reopenRound",
  "galleries.requestArchive",
  "galleries.revokeGuest",
  "galleries.revokePartner",
  "galleries.setSelection",
  "galleries.submitRound",
  "galleries.unlock",
  "galleries.update",
  "galleries.updateItem",
  "galleries.verifyDemoFixture",
  "galleries.viewItem",
  "galleries.viewSession",
  "giftRegistry.addItem",
  "giftRegistry.contribute",
  "giftRegistry.create",
  "giftRegistry.getBySlug",
  "giftRegistry.invoiceItem",
  "giftRegistry.list",
  "giftRegistry.listItems",
  "guidance.contexts",
  "guidance.dismiss",
  "guidance.list",
  "guidance.reset",
  "guidance.start",
  "i18n.deleteTranslation",
  "i18n.getMyLocale",
  "i18n.getTranslation",
  "i18n.listTranslations",
  "i18n.setMyLocale",
  "i18n.setTranslation",
  "i18n.translatedIds",
  "i18n.translationIndex",
  "imports.commit",
  "imports.list",
  "imports.map",
  "imports.preview",
  "imports.previewFromSource",
  "imports.publish",
  "imports.reconcile",
  "imports.reviewConflicts",
  "imports.rollback",
  "imports.start",
  "invitations.accept",
  "invitations.create",
  "invitations.inspect",
  "invitations.list",
  "invitations.resend",
  "invitations.revoke",
  "invitations.roles",
  "invoicing.addTaxRate",
  "invoicing.adjustCustomerBalance",
  "invoicing.applyCustomerBalance",
  "invoicing.assessLateFee",
  "invoicing.beginInPersonPayment",
  "invoicing.beginPaymentCheckout",
  "invoicing.cancelPayment",
  "invoicing.cancelPaymentPlan",
  "invoicing.cancelRefund",
  "invoicing.completePaymentCheckout",
  "invoicing.createCreditNote",
  "invoicing.createDepositAndBalance",
  "invoicing.createDraft",
  "invoicing.createFlexiblePayment",
  "invoicing.createPayment",
  "invoicing.createPaymentPlan",
  "invoicing.createRefund",
  "invoicing.createSchedule",
  "invoicing.createTaxCategory",
  "invoicing.createTaxZone",
  "invoicing.failPayment",
  "invoicing.failRefund",
  "invoicing.get",
  "invoicing.getCustomerBalance",
  "invoicing.getPayment",
  "invoicing.getPaymentPlan",
  "invoicing.installTaxTemplate",
  "invoicing.issue",
  "invoicing.issueCreditNote",
  "invoicing.list",
  "invoicing.listInPersonPayments",
  "invoicing.listPaymentDisputes",
  "invoicing.listPaymentProviders",
  "invoicing.listPayments",
  "invoicing.listPointOfSale",
  "invoicing.listProviderPayouts",
  "invoicing.listSavedPaymentMethods",
  "invoicing.listSchedules",
  "invoicing.listTaxTemplates",
  "invoicing.loadDemoFixture",
  "invoicing.markOverdue",
  "invoicing.markOverdueSweep",
  "invoicing.markViewed",
  "invoicing.processPaymentProviderEvents",
  "invoicing.purgeDemoFixture",
  "invoicing.quoteTax",
  "invoicing.receipt",
  "invoicing.reconcileAdvancedMoney",
  "invoicing.reconcileInPersonPayments",
  "invoicing.reconcilePaymentProviders",
  "invoicing.reconcileProviderPayout",
  "invoicing.reconciliation",
  "invoicing.recordOfflinePayment",
  "invoicing.recordOfflineRefund",
  "invoicing.recordProviderBalanceTransaction",
  "invoicing.recordProviderPayout",
  "invoicing.refreshPaymentPlans",
  "invoicing.refundCustomerBalancePayment",
  "invoicing.refundInPersonPayment",
  "invoicing.reminders",
  "invoicing.revokeSavedPaymentMethod",
  "invoicing.runSchedules",
  "invoicing.scheduleReminders",
  "invoicing.setTaxExemption",
  "invoicing.setTaxRegistration",
  "invoicing.settlePayment",
  "invoicing.settleRefund",
  "invoicing.startPayment",
  "invoicing.startRefund",
  "invoicing.submitProviderRefund",
  "invoicing.taxConfiguration",
  "invoicing.taxThresholds",
  "invoicing.updateSchedule",
  "invoicing.verifyDemoFixture",
  "invoicing.void",
  "invoicing.voidCreditNote",
  "locations.create",
  "locations.createSetupLocation",
  "locations.get",
  "locations.list",
  "locations.primary",
  "locations.remove",
  "locations.setHours",
  "locations.setPrimary",
  "locations.setServiceArea",
  "locations.update",
  "loyalty.adjustPoints",
  "loyalty.earnRules",
  "loyalty.earnableEvents",
  "loyalty.enrol",
  "loyalty.liability",
  "loyalty.myStatement",
  "loyalty.programs",
  "loyalty.redeem",
  "loyalty.redemptions",
  "loyalty.reevaluateTier",
  "loyalty.rewards",
  "loyalty.saveEarnRule",
  "loyalty.saveProgram",
  "loyalty.saveReward",
  "loyalty.saveTier",
  "loyalty.statement",
  "loyalty.tiers",
  "mail.beginOAuth",
  "mail.completeOAuth",
  "mail.registerSender",
  "mail.releaseSuppression",
  "mail.setDefaultSender",
  "mail.status",
  "mail.testSend",
  "mail.updateSender",
  "mail.verifySender",
  "marketplace.connect",
  "marketplace.list",
  "marketplace.sync",
  "media.abortUpload",
  "media.acceptAltTextSuggestion",
  "media.altTextSuggestionState",
  "media.appendCaptureChunk",
  "media.assembleCapture",
  "media.attachCaptureUpload",
  "media.authorizeAssetDownload",
  "media.authorizeObjectDelivery",
  "media.beginUpload",
  "media.bindCaptureAsset",
  "media.completeUpload",
  "media.confirmCapture",
  "media.createCaptureSession",
  "media.createUploadLink",
  "media.discardCapture",
  "media.dismissAltTextSuggestion",
  "media.expireCaptureSessions",
  "media.generateAltTextSuggestion",
  "media.get",
  "media.getCaptureSession",
  "media.grantCapturePermission",
  "media.list",
  "media.listAltTextSuggestionStates",
  "media.listCaptureSessions",
  "media.purge",
  "media.rescan",
  "media.resolveAsset",
  "media.resolveImage",
  "media.restore",
  "media.reviewCapture",
  "media.setAltText",
  "media.setFocalPoint",
  "media.signUploadParts",
  "media.stageCompletedUpload",
  "media.startCapture",
  "media.stopCapture",
  "media.trash",
  "media.updateDetails",
  "media.upload",
  "media.uploadStatus",
  "media.usage",
  "messaging.checkNumbers",
  "messaging.complianceEvents",
  "messaging.createKeywordRule",
  "messaging.deleteKeywordRule",
  "messaging.endSiteChat",
  "messaging.escalateAssistantChat",
  "messaging.evaluateSmsPolicy",
  "messaging.getSiteChat",
  "messaging.importNumbers",
  "messaging.keywordEvents",
  "messaging.keywordRules",
  "messaging.numbers",
  "messaging.postSiteChat",
  "messaging.registrations",
  "messaging.sendAssistantChatMessage",
  "messaging.sendSms",
  "messaging.setRegistration",
  "messaging.setWindow",
  "messaging.startSiteChat",
  "messaging.updateKeywordRule",
  "messaging.updateNumber",
  "messaging.windows",
  "newsletters.confirm",
  "newsletters.create",
  "newsletters.createIssue",
  "newsletters.get",
  "newsletters.list",
  "newsletters.listPublic",
  "newsletters.listPublicIssues",
  "newsletters.publishIssue",
  "newsletters.resolvePublicIssue",
  "newsletters.subscribe",
  "newsletters.unsubscribe",
  "newsletters.update",
  "newsletters.updateIssue",
  "notes.edit",
  "notes.history",
  "notes.list",
  "notes.pin",
  "notes.remove",
  "notes.write",
  "notifications.archive",
  "notifications.list",
  "notifications.markAllRead",
  "notifications.markRead",
  "notifications.preferences",
  "notifications.unreadCount",
  "notifications.updatePreference",
  "notifications.updatePreferences",
  "notifications.updateSettings",
  "paywalls.evaluate",
  "paywalls.list",
  "paywalls.save",
  "platform.applyUpdate",
  "platform.cancelJob",
  "platform.checkUpdates",
  "platform.compatibility",
  "platform.cspViolations",
  "platform.describeRelease",
  "platform.describeUpdateTargets",
  "platform.doctor",
  "platform.evaluateUpdatePolicy",
  "platform.export",
  "platform.forkStatus",
  "platform.getJob",
  "platform.getOutboxEvent",
  "platform.getUpdatePolicy",
  "platform.inspectSeams",
  "platform.jobSummary",
  "platform.listJobQueues",
  "platform.listJobs",
  "platform.listOutboxEvents",
  "platform.listUpdateRuns",
  "platform.openForkUpdate",
  "platform.outboxSummary",
  "platform.preflightUpdate",
  "platform.redriveDeadLetters",
  "platform.replayOutboxEvent",
  "platform.retryJob",
  "platform.saveUpdatePolicy",
  "platform.source",
  "platform.updateCheckPolicy",
  "platform.verifyReleaseFeed",
  "platform.version",
  "plugins.addRegistry",
  "plugins.cacheRegistry",
  "plugins.disable",
  "plugins.enable",
  "plugins.get",
  "plugins.install",
  "plugins.list",
  "plugins.listCatalog",
  "plugins.listRegistries",
  "plugins.rollback",
  "plugins.uninstall",
  "plugins.update",
  "popups.capture",
  "popups.decide",
  "popups.get",
  "popups.list",
  "popups.performance",
  "popups.record",
  "popups.remove",
  "popups.save",
  "popups.saveBlocks",
  "popups.setStatus",
  "portal.myProfile",
  "portal.myRecords",
  "portal.updateMyProfile",
  "printOnDemand.list",
  "printOnDemand.queue",
  "printOnDemand.submit",
  "privacy.cancelMyDataRequest",
  "privacy.createMyDataRequest",
  "privacy.downloadMyDataRequestArtifact",
  "privacy.getMyProfile",
  "privacy.listMyDataRequests",
  "privacy.setMyMarketingPreference",
  "projects.addTask",
  "projects.addTestimonial",
  "projects.addToCollection",
  "projects.attachFile",
  "projects.create",
  "projects.createCollection",
  "projects.detachFile",
  "projects.forSubject",
  "projects.get",
  "projects.getCollection",
  "projects.link",
  "projects.list",
  "projects.listCollections",
  "projects.portfolioBrowse",
  "projects.publicForService",
  "projects.publish",
  "projects.publishCollection",
  "projects.recordConsent",
  "projects.removeFromCollection",
  "projects.removeOutcome",
  "projects.removeTask",
  "projects.resolvePublicProject",
  "projects.revokeConsent",
  "projects.saveCaseStudy",
  "projects.setOutcome",
  "projects.setTaskStatus",
  "projects.setTestimonialStatus",
  "projects.unlink",
  "projects.unpublish",
  "projects.unpublishCollection",
  "projects.update",
  "projects.updateCaseStudySettings",
  "projects.updateCollection",
  "proof.publishedPaths",
  "proof.seedNotice",
  "quotes.accept",
  "quotes.byPartnerToken",
  "quotes.byToken",
  "quotes.chooseOptions",
  "quotes.convert",
  "quotes.create",
  "quotes.decline",
  "quotes.expire",
  "quotes.get",
  "quotes.invitePartner",
  "quotes.list",
  "quotes.loadDemoFixture",
  "quotes.markViewed",
  "quotes.message",
  "quotes.purgeDemoFixture",
  "quotes.revise",
  "quotes.revokePartner",
  "quotes.send",
  "quotes.setConversion",
  "quotes.setItems",
  "quotes.verifyDemoFixture",
  "referrals.acceptInvitation",
  "referrals.approvePayoutBatch",
  "referrals.attributionFor",
  "referrals.buildPayoutBatch",
  "referrals.codes",
  "referrals.commissions",
  "referrals.invitations",
  "referrals.invite",
  "referrals.issueCode",
  "referrals.markPayoutBatchPaid",
  "referrals.payoutBatchCsv",
  "referrals.payoutBatches",
  "referrals.payoutLines",
  "referrals.programs",
  "referrals.recordTouch",
  "referrals.saveProgram",
  "referrals.saveTaxProfile",
  "referrals.taxPrompts",
  "rentals.close",
  "rentals.handOver",
  "rentals.list",
  "rentals.listTerms",
  "rentals.markOverdue",
  "rentals.quote",
  "rentals.reserve",
  "rentals.setTerms",
  "rentals.takeBack",
  "reporting.loadDemoFixture",
  "reporting.purgeDemoFixture",
  "reporting.verifyDemoFixture",
  "reports.cohort",
  "reports.definitions",
  "reports.deleteExport",
  "reports.deleteView",
  "reports.downloadExport",
  "reports.exportFile",
  "reports.funnel",
  "reports.listExportRuns",
  "reports.listExports",
  "reports.listViews",
  "reports.queueExportRunDelivery",
  "reports.revenue",
  "reports.revenueBy",
  "reports.runExport",
  "reports.saveExport",
  "reports.saveView",
  "reviews.aggregate",
  "reviews.ingestExternal",
  "reviews.list",
  "reviews.moderate",
  "reviews.published",
  "reviews.reply",
  "reviews.request",
  "reviews.submit",
  "roles.assign",
  "roles.create",
  "roles.delete",
  "roles.list",
  "roles.modules",
  "roles.update",
  "roles.users",
  "scheduling.slots",
  "scoring.advance",
  "scoring.applyThresholds",
  "scoring.award",
  "scoring.for",
  "scoring.removeRule",
  "scoring.rules",
  "scoring.saveRule",
  "scoring.why",
  "seed.installPreset",
  "segments.capture",
  "segments.contains",
  "segments.fields",
  "segments.list",
  "segments.members",
  "segments.preview",
  "segments.remove",
  "segments.save",
  "segments.why",
  "seo.deleteRedirect",
  "seo.listRedirects",
  "seo.recordRedirect",
  "seo.resolveRedirect",
  "settings.completeSetup",
  "settings.finishSetupAsOwner",
  "settings.getBusiness",
  "settings.getDesign",
  "settings.getModuleConfig",
  "settings.listModules",
  "settings.patchBusiness",
  "settings.resetDesign",
  "settings.saveSetupBusiness",
  "settings.setModuleConfig",
  "settings.setModuleEnabled",
  "settings.setupState",
  "settings.updateBusiness",
  "settings.updateDesign",
  "share.embedSnippet",
  "share.forgetTarget",
  "share.linkReport",
  "share.resolveLink",
  "share.saveTarget",
  "share.shareVia",
  "share.targetFor",
  "share.targets",
  "signupContactImports.beginOAuth",
  "signupContactImports.commit",
  "signupContactImports.completeOAuth",
  "signupContactImports.disconnect",
  "signupContactImports.get",
  "signupContactImports.getOffer",
  "signupContactImports.getPolicy",
  "signupContactImports.listProviderContacts",
  "signupContactImports.revert",
  "signupContactImports.setPolicy",
  "signupContactImports.skip",
  "signupContactImports.stageDevice",
  "signupContactImports.stageFile",
  "signupContactImports.stageProvider",
  "social.assignProfile",
  "social.attributionReport",
  "social.beginOAuth",
  "social.checkHealth",
  "social.completeOAuth",
  "social.composePackage",
  "social.createVariants",
  "social.disconnectProfile",
  "social.draftFromPackage",
  "social.ingestProfile",
  "social.interactionList",
  "social.networks",
  "social.packageList",
  "social.profiles",
  "social.publicationCalendar",
  "social.publishDue",
  "social.reviewProfile",
  "social.reviewVariant",
  "social.schedulePublications",
  "social.setPolicy",
  "social.staffMembers",
  "social.syncGbp",
  "social.syncGbpHours",
  "social.syncGbpReviews",
  "social.variantList",
  "subscriptions.attachProviderSchedule",
  "subscriptions.cancel",
  "subscriptions.cancelAgreement",
  "subscriptions.cancelMine",
  "subscriptions.cancelMyAgreement",
  "subscriptions.changeMine",
  "subscriptions.changePlan",
  "subscriptions.chargePlatformInvoice",
  "subscriptions.enroll",
  "subscriptions.get",
  "subscriptions.list",
  "subscriptions.listOffered",
  "subscriptions.listPlans",
  "subscriptions.pause",
  "subscriptions.resume",
  "subscriptions.savePlan",
  "subscriptions.subscribe",
  "tasks.create",
  "tasks.list",
  "tasks.remove",
  "tasks.setStatus",
  "tasks.update",
  "templates.get",
  "templates.list",
  "templates.render",
  "templates.reset",
  "templates.save",
  "templates.slots",
  "time.invoice",
  "time.list",
  "time.log",
  "time.rates",
  "time.remove",
  "time.setRate",
  "time.start",
  "time.stop",
  "time.update",
  "views.default",
  "views.entities",
  "views.list",
  "views.remove",
  "views.save",
  "views.setDefault",
  "voiceVideo.list",
  "voiceVideo.record",
  "waitlist.claim",
  "waitlist.expireOffers",
  "waitlist.join",
  "waitlist.list",
  "waitlist.offer",
  "waitlist.setPosition",
  "waitlist.withdraw",
  "webhooks.create",
  "webhooks.deliveries",
  "webhooks.inspectDelivery",
  "webhooks.list",
  "webhooks.remove",
  "webhooks.replay",
  "webhooks.rotateEndpoint",
  "webhooks.rotateSecret",
  "webhooks.secret",
  "webhooks.test",
  "webhooks.update",
] as const;

export type ServiceName = (typeof SERVICE_NAMES)[number];

export interface ServiceCatalog {
  "ads.addSize": {
    input: { label: string; width: number; height: number; breakpoint: "desktop" | "tablet" | "mobile"; iabName?: string | null };
    output: { id: string; label: string; width: number; height: number; breakpoint: "desktop" | "tablet" | "mobile"; iabName: string | null; [key: string]: unknown };
  };
  "ads.adsTxt": {
    input: { surface: "web" | "app" };
    output: { body: string; [key: string]: unknown };
  };
  "ads.advertisers": {
    input: Record<string, never>;
    output: { id: string; contactId: string; displayName: string | null; website: string | null; billingTerms: string | null; [key: string]: unknown }[];
  };
  "ads.campaignReport": {
    input: { campaignId: string };
    output: { campaignId: string; impressions: number; viewableImpressions: number; uniques: number; clicks: number; spendCents: number; bookedMinor: number; days: { lineItemId: string; creativeId: string; slotId: string; day: string; impressions: number; viewableImpressions: number; uniques: number; clicks: number; spendCents: number; [key: string]: unknown }[]; [key: string]: unknown };
  };
  "ads.campaigns": {
    input: { advertiserContactId?: string; status?: "draft" | "scheduled" | "live" | "paused" | "completed" };
    output: { id: string; advertiserContactId: string; name: string; startsAt: string | null; endsAt: string | null; status: "draft" | "scheduled" | "live" | "paused" | "completed"; pricing: "cpm" | "cpc" | "flat" | "house"; rateCents: number; budgetCents: number | null; pacing: "even" | "asap"; invoiceId: string | null; priority: number; approvalState: "none" | "pending" | "approved" | "rejected"; [key: string]: unknown }[];
  };
  "ads.creatives": {
    input: { campaignId: string };
    output: { id: string; lineItemId: string; kind: "image" | "native" | "html_tag" | "provider"; assetId: string | null; width: number; height: number; clickUrl: string; altText: string | null; headline: string | null; body: string | null; ctaLabel: string | null; tagHtml: string | null; provider: unknown | null; status: "draft" | "active" | "paused"; reviewState: "pending" | "approved" | "rejected"; reviewNote: string | null; [key: string]: unknown }[];
  };
  "ads.decideCampaign": {
    input: { id: string; decision: "approved" | "rejected"; note?: string | null };
    output: { id: string; advertiserContactId: string; name: string; startsAt: string | null; endsAt: string | null; status: "draft" | "scheduled" | "live" | "paused" | "completed"; pricing: "cpm" | "cpc" | "flat" | "house"; rateCents: number; budgetCents: number | null; pacing: "even" | "asap"; invoiceId: string | null; priority: number; approvalState: "none" | "pending" | "approved" | "rejected"; [key: string]: unknown };
  };
  "ads.deleteTxtEntry": {
    input: { id: string };
    output: { id: string; [key: string]: unknown };
  };
  "ads.ensureSizes": {
    input: Record<string, never>;
    output: { present: number; added: number; [key: string]: unknown };
  };
  "ads.invoiceCampaign": {
    input: { id: string };
    output: { invoiceId: string; amountMinor: number; currency: string; [key: string]: unknown };
  };
  "ads.lineItems": {
    input: { campaignId: string };
    output: { id: string; campaignId: string; name: string; slotIds: unknown; targeting: unknown; dayparting: unknown; frequencyCap: number | null; frequencyPeriodHours: number; goalImpressions: number | null; goalClicks: number | null; weight: number; status: "draft" | "active" | "paused" | "completed"; [key: string]: unknown }[];
  };
  "ads.reconcileCampaign": {
    input: { id: string };
    output: { bookedMinor: number; deliveredMinor: number; creditedMinor: number; creditNoteId: string | null; [key: string]: unknown };
  };
  "ads.recordBeacon": {
    input: { kind: "impression" | "viewable"; creativeId: string; slotId: string; anonId?: string | null; sessionId?: string | null; path?: string };
    output: { counted: boolean; [key: string]: unknown };
  };
  "ads.recordClick": {
    input: { token: string; anonId?: string | null; sessionId?: string | null; path?: string };
    output: { url: string; [key: string]: unknown };
  };
  "ads.reviewCreative": {
    input: { id: string; decision: "approved" | "rejected"; note?: string | null };
    output: { id: string; lineItemId: string; kind: "image" | "native" | "html_tag" | "provider"; assetId: string | null; width: number; height: number; clickUrl: string; altText: string | null; headline: string | null; body: string | null; ctaLabel: string | null; tagHtml: string | null; provider: unknown | null; status: "draft" | "active" | "paused"; reviewState: "pending" | "approved" | "rejected"; reviewNote: string | null; [key: string]: unknown };
  };
  "ads.saveAdvertiser": {
    input: { contactId?: string; email?: string; name?: string; displayName?: string | null; website?: string | null; notes?: string | null; billingTerms?: string | null };
    output: { id: string; contactId: string; displayName: string | null; website: string | null; billingTerms: string | null; [key: string]: unknown };
  };
  "ads.saveCampaign": {
    input: { id?: string; advertiserContactId: string; name: string; startsAt?: string | null; endsAt?: string | null; pricing?: "cpm" | "cpc" | "flat" | "house"; rateCents?: number; budgetCents?: number | null; pacing?: "even" | "asap"; invoiceId?: string | null; priority?: number };
    output: { id: string; advertiserContactId: string; name: string; startsAt: string | null; endsAt: string | null; status: "draft" | "scheduled" | "live" | "paused" | "completed"; pricing: "cpm" | "cpc" | "flat" | "house"; rateCents: number; budgetCents: number | null; pacing: "even" | "asap"; invoiceId: string | null; priority: number; approvalState: "none" | "pending" | "approved" | "rejected"; [key: string]: unknown };
  };
  "ads.saveCreative": {
    input: { id?: string; lineItemId: string; kind?: "image" | "native" | "html_tag" | "provider"; assetId?: string | null; width: number; height: number; clickUrl?: string; altText?: string | null; headline?: string | null; body?: string | null; ctaLabel?: string | null; tagHtml?: string | null; provider?: { network: string; unitPath: string; params?: { [key: string]: string } } | null; status?: "draft" | "active" | "paused" };
    output: { id: string; lineItemId: string; kind: "image" | "native" | "html_tag" | "provider"; assetId: string | null; width: number; height: number; clickUrl: string; altText: string | null; headline: string | null; body: string | null; ctaLabel: string | null; tagHtml: string | null; provider: unknown | null; status: "draft" | "active" | "paused"; reviewState: "pending" | "approved" | "rejected"; reviewNote: string | null; [key: string]: unknown };
  };
  "ads.saveLineItem": {
    input: { id?: string; campaignId: string; name: string; slotIds: string[]; targeting?: { locales?: string[]; countries?: string[]; devices?: ("desktop" | "tablet" | "mobile")[]; pathPatterns?: string[]; referrers?: string[] }; dayparting?: { days?: number[]; fromMinute?: number; toMinute?: number }; frequencyCap?: number | null; frequencyPeriodHours?: number; goalImpressions?: number | null; goalClicks?: number | null; weight?: number; status?: "draft" | "active" | "paused" | "completed" };
    output: { id: string; campaignId: string; name: string; slotIds: unknown; targeting: unknown; dayparting: unknown; frequencyCap: number | null; frequencyPeriodHours: number; goalImpressions: number | null; goalClicks: number | null; weight: number; status: "draft" | "active" | "paused" | "completed"; [key: string]: unknown };
  };
  "ads.saveSlot": {
    input: { id?: string; name: string; code: string; description?: string | null; formats?: { breakpoint: "desktop" | "tablet" | "mobile"; sizes: { width: number; height: number }[] }[]; lazy?: boolean; refreshSeconds?: number; allowHouseFill?: boolean; allowThirdParty?: boolean; status?: "draft" | "active" | "retired" };
    output: { id: string; name: string; code: string; description: string | null; formats: unknown; lazy: boolean; refreshSeconds: number; allowHouseFill: boolean; allowThirdParty: boolean; status: "draft" | "active" | "retired"; [key: string]: unknown };
  };
  "ads.saveTxtEntry": {
    input: { domain: string; accountId: string; relationship: "DIRECT" | "RESELLER"; certificationAuthorityId?: string | null; surface?: "web" | "app" | "both" };
    output: { id: string; domain: string; accountId: string; relationship: "DIRECT" | "RESELLER"; certificationAuthorityId: string | null; surface: "web" | "app" | "both"; [key: string]: unknown };
  };
  "ads.serve": {
    input: { code: string; path?: string; locale?: string; country?: string | null; referrer?: string | null; anonId?: string | null; thirdPartyConsent?: ("granted" | "denied") | null };
    output: { code: string; lazy: boolean; fills: { breakpoint: "desktop" | "tablet" | "mobile"; width: number; height: number; creative: { id: string; kind: "image" | "native" | "html_tag" | "provider"; assetId: string | null; altText: string | null; headline: string | null; body: string | null; ctaLabel: string | null; tagHtml: string | null; provider: unknown | null; href: string; label: "sponsored" | "house"; lineItemId: string; campaignId: string; slotId: string; [key: string]: unknown } | null; needsThirdPartyConsent: boolean; [key: string]: unknown }[]; [key: string]: unknown } | null;
  };
  "ads.setCampaignStatus": {
    input: { id: string; status: "draft" | "scheduled" | "live" | "paused" | "completed" };
    output: { id: string; advertiserContactId: string; name: string; startsAt: string | null; endsAt: string | null; status: "draft" | "scheduled" | "live" | "paused" | "completed"; pricing: "cpm" | "cpc" | "flat" | "house"; rateCents: number; budgetCents: number | null; pacing: "even" | "asap"; invoiceId: string | null; priority: number; approvalState: "none" | "pending" | "approved" | "rejected"; [key: string]: unknown };
  };
  "ads.sizes": {
    input: { breakpoint?: "desktop" | "tablet" | "mobile" };
    output: { id: string; label: string; width: number; height: number; breakpoint: "desktop" | "tablet" | "mobile"; iabName: string | null; [key: string]: unknown }[];
  };
  "ads.slotByCode": {
    input: { code: string };
    output: { code: string; formats: unknown; lazy: boolean; refreshSeconds: number; allowHouseFill: boolean; [key: string]: unknown } | null;
  };
  "ads.slots": {
    input: Record<string, never>;
    output: { id: string; name: string; code: string; description: string | null; formats: unknown; lazy: boolean; refreshSeconds: number; allowHouseFill: boolean; allowThirdParty: boolean; status: "draft" | "active" | "retired"; [key: string]: unknown }[];
  };
  "ads.txtEntries": {
    input: Record<string, never>;
    output: { id: string; domain: string; accountId: string; relationship: "DIRECT" | "RESELLER"; certificationAuthorityId: string | null; surface: "web" | "app" | "both"; [key: string]: unknown }[];
  };
  "agents.approveWrite": {
    input: { id: string; note?: string };
    output: { approval: { id: string; runId: string | null; taskId: string; kind: "blocks" | "message" | "money" | "destructive" | "write"; summary: string; preview: unknown; serviceName: string; input: unknown; proposedAutonomy: "suggest" | "approve" | "autonomous"; status: "pending" | "approved" | "rejected" | "expired"; decidedBy: string | null; decidedAt: string | null; decisionNote: string | null; expiresAt: string | null; createdAt: string; [key: string]: unknown }; result: unknown | null; [key: string]: unknown };
  };
  "agents.assignTask": {
    input: { id: string; agentId: string | null };
    output: { id: string; parentId: string | null; rootId: string; agentId: string | null; title: string; brief: string; input: unknown; inputTrust: "owner" | "system" | "untrusted"; status: "queued" | "running" | "waiting_approval" | "blocked" | "done" | "failed" | "needs_attention" | "cancelled"; priority: number; dependsOn: string[]; dueAt: string | null; autonomyCeiling: ("suggest" | "approve" | "autonomous") | null; budgetCents: number | null; result: unknown | null; failureReason: string | null; attempts: number; createdByActor: string; source: "human" | "schedule" | "event" | "agent"; sourceRef: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "agents.board": {
    input: { agentId?: string; unassigned?: boolean; dueBefore?: string; minPriority?: number };
    output: { column: "queued" | "running" | "waiting_approval" | "needs_attention" | "done"; tasks: { id: string; parentId: string | null; rootId: string; agentId: string | null; title: string; brief: string; input: unknown; inputTrust: "owner" | "system" | "untrusted"; status: "queued" | "running" | "waiting_approval" | "blocked" | "done" | "failed" | "needs_attention" | "cancelled"; priority: number; dependsOn: string[]; dueAt: string | null; autonomyCeiling: ("suggest" | "approve" | "autonomous") | null; budgetCents: number | null; result: unknown | null; failureReason: string | null; attempts: number; createdByActor: string; source: "human" | "schedule" | "event" | "agent"; sourceRef: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[]; [key: string]: unknown }[];
  };
  "agents.cancelTask": {
    input: { id: string; reason?: string };
    output: { cancelled: number };
  };
  "agents.claimTask": {
    input: { assignedOnly?: boolean };
    output: { runId: string; leaseExpiresAt: string; leaseMinutes: number; task: { id: string; rootId: string; parentId: string | null; title: string; brief: string; input: unknown; inputTrust: "owner" | "system" | "untrusted"; attempt: number; budgetCents: number | null }; agent: { name: string; role: string; instructions: string }; autonomy: "suggest" | "approve" | "autonomous"; guidance: string; [key: string]: unknown } | null;
  };
  "agents.completeTask": {
    input: { runId: string; outcome: "done" | "failed" | "refused"; result?: { [key: string]: unknown } | null; failureReason?: string | null; stopReason?: ("timeout" | "budget") | null; costCents?: number; tokensIn?: number; tokensOut?: number };
    output: { taskId: string; status: "done" | "needs_attention" | "queued" };
  };
  "agents.connect": {
    input: { name: string; kind: "managed" | "inbound"; adapter?: string | null; model?: string | null; credentialRef?: string | null; baseUrl?: string | null; inputCentsPerMillion?: number | null; outputCentsPerMillion?: number | null; maxConcurrency?: number };
    output: { id: string; name: string; kind: "managed" | "inbound"; adapter: string | null; model: string | null; credentialRef: string | null; baseUrl: string | null; inputCentsPerMillion: number | null; outputCentsPerMillion: number | null; maxConcurrency: number; status: "active" | "paused"; lastSeenAt: string | null; lastError: string | null; createdBy: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "agents.connections": {
    input: Record<string, never>;
    output: { id: string; name: string; kind: "managed" | "inbound"; adapter: string | null; model: string | null; credentialRef: string | null; maxConcurrency: number; status: "active" | "paused"; lastSeenAt: string | null; lastError: string | null; [key: string]: unknown }[];
  };
  "agents.createPlaybook": {
    input: { name: string; note?: string; description?: string; briefTemplate: string; defaultAgentId?: string | null; paramsSchema?: { params?: { name: string; label: string; type?: "string" | "text" | "number" | "boolean" | "choice"; required?: boolean; choices?: string[]; help?: string }[] }; trigger?: "manual" | "schedule" | "event"; scheduleCron?: string | null; eventPattern?: string | null; autonomyCeiling?: ("suggest" | "approve" | "autonomous") | null; budgetCents?: number | null; reportsToBriefing?: boolean; enabled?: boolean };
    output: { id: string; name: string; description: string; briefTemplate: string; defaultAgentId: string | null; paramsSchema: unknown; trigger: "manual" | "schedule" | "event"; scheduleCron: string | null; reportsToBriefing: boolean; timezone: string | null; nextRunAt: string | null; lastRunAt: string | null; catchUp: boolean; lastOutcome: string | null; eventPattern: string | null; enabled: boolean; version: number; autonomyCeiling: ("suggest" | "approve" | "autonomous") | null; budgetCents: number | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "agents.createTask": {
    input: { title: string; brief?: string; input?: { [key: string]: unknown }; inputTrust?: "owner" | "system" | "untrusted"; agentId?: string | null; parentId?: string | null; priority?: number; dependsOn?: string[]; dueAt?: string | null; autonomyCeiling?: ("suggest" | "approve" | "autonomous") | null; budgetCents?: number | null; source?: "human" | "schedule" | "event"; sourceRef?: string };
    output: { id: string; parentId: string | null; rootId: string; agentId: string | null; title: string; brief: string; input: unknown; inputTrust: "owner" | "system" | "untrusted"; status: "queued" | "running" | "waiting_approval" | "blocked" | "done" | "failed" | "needs_attention" | "cancelled"; priority: number; dependsOn: string[]; dueAt: string | null; autonomyCeiling: ("suggest" | "approve" | "autonomous") | null; budgetCents: number | null; result: unknown | null; failureReason: string | null; attempts: number; createdByActor: string; source: "human" | "schedule" | "event" | "agent"; sourceRef: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "agents.deletePlaybook": {
    input: { id: string };
    output: { id: string };
  };
  "agents.expireApprovals": {
    input: Record<string, never>;
    output: { expired: number; [key: string]: unknown };
  };
  "agents.exportPlaybook": {
    input: { id: string };
    output: { freeholderPlaybook: 1; name: string; description: string; briefTemplate: string; paramsSchema: { params: { name: string; label: string; type: "string" | "text" | "number" | "boolean" | "choice"; required: boolean; choices: string[]; help?: string }[] }; trigger: "manual" | "schedule" | "event"; scheduleCron?: string | null; eventPattern?: string | null; autonomyCeiling?: ("suggest" | "approve" | "autonomous") | null; budgetCents?: number | null };
  };
  "agents.flagTask": {
    input: { id: string; reason: string };
    output: { id: string; parentId: string | null; rootId: string; agentId: string | null; title: string; brief: string; input: unknown; inputTrust: "owner" | "system" | "untrusted"; status: "queued" | "running" | "waiting_approval" | "blocked" | "done" | "failed" | "needs_attention" | "cancelled"; priority: number; dependsOn: string[]; dueAt: string | null; autonomyCeiling: ("suggest" | "approve" | "autonomous") | null; budgetCents: number | null; result: unknown | null; failureReason: string | null; attempts: number; createdByActor: string; source: "human" | "schedule" | "event" | "agent"; sourceRef: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "agents.hire": {
    input: { connectionId: string; name: string; role: string; instructions?: string; toolScopes?: string[]; autonomy?: "suggest" | "approve" | "autonomous"; maxConcurrency?: number; budgetCents?: number; budgetPeriod?: "day" | "week" | "month" };
    output: { id: string; connectionId: string; name: string; role: string; instructions: string; apiKeyId: string | null; toolScopes: string[]; autonomy: "suggest" | "approve" | "autonomous"; maxConcurrency: number; budgetCents: number; budgetPeriod: "day" | "week" | "month"; status: "active" | "paused"; createdAt: string; updatedAt: string; token: string; [key: string]: unknown };
  };
  "agents.importPlaybook": {
    input: { document: { freeholderPlaybook: 1; name: string; description?: string; briefTemplate: string; paramsSchema?: { params?: { name: string; label: string; type?: "string" | "text" | "number" | "boolean" | "choice"; required?: boolean; choices?: string[]; help?: string }[] }; trigger?: "manual" | "schedule" | "event"; scheduleCron?: string | null; eventPattern?: string | null; autonomyCeiling?: ("suggest" | "approve" | "autonomous") | null; budgetCents?: number | null }; name?: string };
    output: { id: string; name: string; description: string; briefTemplate: string; defaultAgentId: string | null; paramsSchema: unknown; trigger: "manual" | "schedule" | "event"; scheduleCron: string | null; reportsToBriefing: boolean; timezone: string | null; nextRunAt: string | null; lastRunAt: string | null; catchUp: boolean; lastOutcome: string | null; eventPattern: string | null; enabled: boolean; version: number; autonomyCeiling: ("suggest" | "approve" | "autonomous") | null; budgetCents: number | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "agents.inspectRun": {
    input: { runId: string };
    output: { id: string; taskId: string; agentId: string | null; attempt: number; status: "running" | "done" | "failed" | "cancelled"; startedAt: string; endedAt: string | null; model: string | null; tokensIn: number; tokensOut: number; costCents: number; stopReason: ("done" | "budget" | "timeout" | "refused" | "error" | "cancelled") | null; error: string | null; leaseExpiresAt: string | null; createdAt: string; updatedAt: string; steps: { id: string; runId: string; seq: number; kind: "message" | "tool_call" | "tool_result" | "note"; serviceName: string | null; input: unknown | null; output: unknown | null; tokens: number; durationMs: number | null; error: string | null; createdAt: string; [key: string]: unknown }[]; [key: string]: unknown } | null;
  };
  "agents.list": {
    input: Record<string, never>;
    output: { id: string; name: string; role: string; connectionId: string; toolScopes: string[]; autonomy: "suggest" | "approve" | "autonomous"; maxConcurrency: number; budgetCents: number; budgetPeriod: "day" | "week" | "month"; status: "active" | "paused"; [key: string]: unknown }[];
  };
  "agents.listApprovals": {
    input: { taskId?: string; status?: "pending" | "approved" | "rejected" | "expired"; limit?: number };
    output: { id: string; runId: string | null; taskId: string; kind: "blocks" | "message" | "money" | "destructive" | "write"; summary: string; preview: unknown; serviceName: string; input: unknown; proposedAutonomy: "suggest" | "approve" | "autonomous"; status: "pending" | "approved" | "rejected" | "expired"; decidedBy: string | null; decidedAt: string | null; decisionNote: string | null; expiresAt: string | null; createdAt: string; [key: string]: unknown }[];
  };
  "agents.pause": {
    input: { id: string; paused?: boolean; reason?: string };
    output: { id: string; name: string; status: "active" | "paused"; stoppedRuns: number; [key: string]: unknown };
  };
  "agents.pauseAll": {
    input: { paused?: boolean; reason?: string };
    output: { changed: number; stoppedRuns: number };
  };
  "agents.playbook": {
    input: { id: string };
    output: { id: string; name: string; description: string; briefTemplate: string; defaultAgentId: string | null; paramsSchema: unknown; trigger: "manual" | "schedule" | "event"; scheduleCron: string | null; reportsToBriefing: boolean; timezone: string | null; nextRunAt: string | null; lastRunAt: string | null; catchUp: boolean; lastOutcome: string | null; eventPattern: string | null; enabled: boolean; version: number; autonomyCeiling: ("suggest" | "approve" | "autonomous") | null; budgetCents: number | null; createdAt: string; updatedAt: string; versions: { version: number; briefTemplate: string; note: string | null; createdBy: string | null; createdAt: string; [key: string]: unknown }[]; [key: string]: unknown } | null;
  };
  "agents.playbooks": {
    input: Record<string, never>;
    output: { id: string; name: string; description: string; briefTemplate: string; defaultAgentId: string | null; paramsSchema: unknown; trigger: "manual" | "schedule" | "event"; scheduleCron: string | null; reportsToBriefing: boolean; timezone: string | null; nextRunAt: string | null; lastRunAt: string | null; catchUp: boolean; lastOutcome: string | null; eventPattern: string | null; enabled: boolean; version: number; autonomyCeiling: ("suggest" | "approve" | "autonomous") | null; budgetCents: number | null; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "agents.proposeWrite": {
    input: { runId: string; serviceName: string; input?: { [key: string]: unknown }; summary?: string };
    output: { outcome: "executed" | "proposed" | "awaiting_approval"; result: unknown | null; approval: { id: string; runId: string | null; taskId: string; kind: "blocks" | "message" | "money" | "destructive" | "write"; summary: string; preview: unknown; serviceName: string; input: unknown; proposedAutonomy: "suggest" | "approve" | "autonomous"; status: "pending" | "approved" | "rejected" | "expired"; decidedBy: string | null; decidedAt: string | null; decisionNote: string | null; expiresAt: string | null; createdAt: string; [key: string]: unknown } | null; [key: string]: unknown };
  };
  "agents.rejectWrite": {
    input: { id: string; note: string };
    output: { approval: { id: string; runId: string | null; taskId: string; kind: "blocks" | "message" | "money" | "destructive" | "write"; summary: string; preview: unknown; serviceName: string; input: unknown; proposedAutonomy: "suggest" | "approve" | "autonomous"; status: "pending" | "approved" | "rejected" | "expired"; decidedBy: string | null; decidedAt: string | null; decisionNote: string | null; expiresAt: string | null; createdAt: string; [key: string]: unknown }; [key: string]: unknown };
  };
  "agents.releaseTask": {
    input: { runId: string; reason?: string };
    output: { taskId: string; status: "queued" };
  };
  "agents.reopenTask": {
    input: { id: string };
    output: { id: string; parentId: string | null; rootId: string; agentId: string | null; title: string; brief: string; input: unknown; inputTrust: "owner" | "system" | "untrusted"; status: "queued" | "running" | "waiting_approval" | "blocked" | "done" | "failed" | "needs_attention" | "cancelled"; priority: number; dependsOn: string[]; dueAt: string | null; autonomyCeiling: ("suggest" | "approve" | "autonomous") | null; budgetCents: number | null; result: unknown | null; failureReason: string | null; attempts: number; createdByActor: string; source: "human" | "schedule" | "event" | "agent"; sourceRef: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "agents.reportStep": {
    input: { runId: string; kind: "message" | "tool_call" | "tool_result" | "note"; serviceName?: string | null; input?: { [key: string]: unknown } | null; output?: { [key: string]: unknown } | null; tokens?: number; durationMs?: number | null; error?: string | null };
    output: { stepId: string; seq: number; leaseExpiresAt: string };
  };
  "agents.retryTask": {
    input: { id: string };
    output: { id: string; parentId: string | null; rootId: string; agentId: string | null; title: string; brief: string; input: unknown; inputTrust: "owner" | "system" | "untrusted"; status: "queued" | "running" | "waiting_approval" | "blocked" | "done" | "failed" | "needs_attention" | "cancelled"; priority: number; dependsOn: string[]; dueAt: string | null; autonomyCeiling: ("suggest" | "approve" | "autonomous") | null; budgetCents: number | null; result: unknown | null; failureReason: string | null; attempts: number; createdByActor: string; source: "human" | "schedule" | "event" | "agent"; sourceRef: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "agents.runPlaybook": {
    input: { id: string; params?: { [key: string]: unknown } };
    output: { taskId: string; brief: string; version: number; [key: string]: unknown };
  };
  "agents.setPlaybookSchedule": {
    input: { id: string; cron: string; timezone?: string; catchUp?: boolean };
    output: { id: string; scheduleCron: string; timezone: string; catchUp: boolean; nextRunAt: string | null; [key: string]: unknown };
  };
  "agents.spend": {
    input: Record<string, never>;
    output: { id: string; name: string; status: "active" | "paused"; budgetCents: number; budgetPeriod: "day" | "week" | "month"; spentCents: number; remainingCents: number; tokensIn: number; tokensOut: number; runs: number; model: string | null; priced: boolean; [key: string]: unknown }[];
  };
  "agents.stopRun": {
    input: { runId: string; reason?: string };
    output: { id: string; taskId: string; agentId: string | null; attempt: number; status: "running" | "done" | "failed" | "cancelled"; startedAt: string; endedAt: string | null; model: string | null; tokensIn: number; tokensOut: number; costCents: number; stopReason: ("done" | "budget" | "timeout" | "refused" | "error" | "cancelled") | null; error: string | null; leaseExpiresAt: string | null; createdAt: string; updatedAt: string; taskStatus: "queued" | "needs_attention"; [key: string]: unknown };
  };
  "agents.tailRun": {
    input: { runId: string; afterSeq?: number };
    output: { id: string; taskId: string; agentId: string | null; attempt: number; status: "running" | "done" | "failed" | "cancelled"; startedAt: string; endedAt: string | null; model: string | null; tokensIn: number; tokensOut: number; costCents: number; stopReason: ("done" | "budget" | "timeout" | "refused" | "error" | "cancelled") | null; error: string | null; leaseExpiresAt: string | null; createdAt: string; updatedAt: string; live: boolean; steps: { id: string; runId: string; seq: number; kind: "message" | "tool_call" | "tool_result" | "note"; serviceName: string | null; input: unknown | null; output: unknown | null; tokens: number; durationMs: number | null; error: string | null; createdAt: string; [key: string]: unknown }[]; [key: string]: unknown } | null;
  };
  "agents.task": {
    input: { id: string };
    output: { id: string; parentId: string | null; rootId: string; agentId: string | null; title: string; brief: string; input: unknown; inputTrust: "owner" | "system" | "untrusted"; status: "queued" | "running" | "waiting_approval" | "blocked" | "done" | "failed" | "needs_attention" | "cancelled"; priority: number; dependsOn: string[]; dueAt: string | null; autonomyCeiling: ("suggest" | "approve" | "autonomous") | null; budgetCents: number | null; result: unknown | null; failureReason: string | null; attempts: number; createdByActor: string; source: "human" | "schedule" | "event" | "agent"; sourceRef: string | null; createdAt: string; updatedAt: string; runs: { id: string; taskId: string; agentId: string | null; attempt: number; status: "running" | "done" | "failed" | "cancelled"; startedAt: string; endedAt: string | null; model: string | null; tokensIn: number; tokensOut: number; costCents: number; stopReason: ("done" | "budget" | "timeout" | "refused" | "error" | "cancelled") | null; error: string | null; leaseExpiresAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[]; steps: { id: string; runId: string; seq: number; kind: "message" | "tool_call" | "tool_result" | "note"; serviceName: string | null; input: unknown | null; output: unknown | null; tokens: number; durationMs: number | null; error: string | null; createdAt: string; [key: string]: unknown }[]; children: { id: string; parentId: string | null; rootId: string; agentId: string | null; title: string; brief: string; input: unknown; inputTrust: "owner" | "system" | "untrusted"; status: "queued" | "running" | "waiting_approval" | "blocked" | "done" | "failed" | "needs_attention" | "cancelled"; priority: number; dependsOn: string[]; dueAt: string | null; autonomyCeiling: ("suggest" | "approve" | "autonomous") | null; budgetCents: number | null; result: unknown | null; failureReason: string | null; attempts: number; createdByActor: string; source: "human" | "schedule" | "event" | "agent"; sourceRef: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[]; [key: string]: unknown } | null;
  };
  "agents.tasks": {
    input: { status?: ("queued" | "running" | "waiting_approval" | "blocked" | "done" | "failed" | "needs_attention" | "cancelled")[]; agentId?: string; unassigned?: boolean; rootId?: string; dueBefore?: string; dueAfter?: string; minPriority?: number; includeCancelled?: boolean; limit?: number };
    output: { id: string; parentId: string | null; rootId: string; agentId: string | null; title: string; brief: string; input: unknown; inputTrust: "owner" | "system" | "untrusted"; status: "queued" | "running" | "waiting_approval" | "blocked" | "done" | "failed" | "needs_attention" | "cancelled"; priority: number; dependsOn: string[]; dueAt: string | null; autonomyCeiling: ("suggest" | "approve" | "autonomous") | null; budgetCents: number | null; result: unknown | null; failureReason: string | null; attempts: number; createdByActor: string; source: "human" | "schedule" | "event" | "agent"; sourceRef: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "agents.update": {
    input: { id: string; role?: string; instructions?: string; autonomy?: "suggest" | "approve" | "autonomous"; maxConcurrency?: number; budgetCents?: number; budgetPeriod?: "day" | "week" | "month"; status?: "active" | "paused" };
    output: { id: string; connectionId: string; name: string; role: string; instructions: string; apiKeyId: string | null; toolScopes: string[]; autonomy: "suggest" | "approve" | "autonomous"; maxConcurrency: number; budgetCents: number; budgetPeriod: "day" | "week" | "month"; status: "active" | "paused"; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "agents.updatePlaybook": {
    input: { id: string; name?: string; note?: string; description?: string; briefTemplate?: string; defaultAgentId?: string | null; paramsSchema?: { params?: { name: string; label: string; type?: "string" | "text" | "number" | "boolean" | "choice"; required?: boolean; choices?: string[]; help?: string }[] }; trigger?: "manual" | "schedule" | "event"; scheduleCron?: string | null; eventPattern?: string | null; autonomyCeiling?: ("suggest" | "approve" | "autonomous") | null; budgetCents?: number | null; enabled?: boolean };
    output: { id: string; name: string; description: string; briefTemplate: string; defaultAgentId: string | null; paramsSchema: unknown; trigger: "manual" | "schedule" | "event"; scheduleCron: string | null; reportsToBriefing: boolean; timezone: string | null; nextRunAt: string | null; lastRunAt: string | null; catchUp: boolean; lastOutcome: string | null; eventPattern: string | null; enabled: boolean; version: number; autonomyCeiling: ("suggest" | "approve" | "autonomous") | null; budgetCents: number | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "agents.updateTask": {
    input: { id: string; title?: string; brief?: string; priority?: number; dueAt?: string | null };
    output: { id: string; parentId: string | null; rootId: string; agentId: string | null; title: string; brief: string; input: unknown; inputTrust: "owner" | "system" | "untrusted"; status: "queued" | "running" | "waiting_approval" | "blocked" | "done" | "failed" | "needs_attention" | "cancelled"; priority: number; dependsOn: string[]; dueAt: string | null; autonomyCeiling: ("suggest" | "approve" | "autonomous") | null; budgetCents: number | null; result: unknown | null; failureReason: string | null; attempts: number; createdByActor: string; source: "human" | "schedule" | "event" | "agent"; sourceRef: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "analytics.campaignAttribution": {
    input: { days?: number; includeBots?: boolean; model?: "first_touch" | "last_touch"; limit?: number };
    output: { source: string; medium: string | null; campaign: string | null; visitors: number; conversions: number }[];
  };
  "analytics.campaignTotals": {
    input: { campaigns: string[]; days?: number; includeBots?: boolean; model?: "first_touch" | "last_touch" };
    output: { campaign: string; visitors: number; conversions: number }[];
  };
  "analytics.classificationCandidates": {
    input: { limit?: number };
    output: { reviewId: string; visitorLabel: string; originalKind: "human" | "bot" | "suspected"; effectiveKind: "human" | "bot" | "suspected"; reasons: string[]; lastPath: string; lastAt: string; views: number }[];
  };
  "analytics.contactActivity": {
    input: { contactId: string; limit?: number };
    output: { id: string; eventKey: string | null; anonId: string; sessionId: string; contactId: string | null; name: string; path: string; referrer: string | null; locale: string | null; visitorKind: "human" | "bot" | "suspected"; botReasons: string[]; classificationOverride: ("human" | "bot" | "suspected") | null; classificationNote: string | null; props: unknown; at: string; [key: string]: unknown }[];
  };
  "analytics.correctClassification": {
    input: { eventId: string; kind: "human" | "bot" | "suspected" | "automatic"; classificationNote?: string };
    output: { updated: number; effectiveKind: ("human" | "bot" | "suspected") | null };
  };
  "analytics.daily": {
    input: { days?: number; includeBots?: boolean; timezone?: string };
    output: { day: string; views: number; visitors: number; [key: string]: unknown }[];
  };
  "analytics.experimentReport": {
    input: Record<string, never>;
    output: { experimentKey: string; variants: { variant: string; impressions: number; uniqueVisitors: number; conversions: number; revenueMinor: number; [key: string]: unknown }[]; uniqueVisitors: number; comparable: boolean }[];
  };
  "analytics.exportAnonymized": {
    input: { days?: number; timezone?: string; includeBots?: boolean };
    output: { filename: string; mime: string; content: string; sha256: string };
  };
  "analytics.funnel": {
    input: { days?: number };
    output: { from: string; to: string; bands: { band: "visit" | "lead" | "interest" | "committed" | "paid" | "returned"; people: number; previousBand: ("visit" | "lead" | "interest" | "committed" | "paid" | "returned") | null; fromPrevious: number | null; stages: { key: string; module: string; labelKey: string; definitionKey: string; people: number; [key: string]: unknown }[]; [key: string]: unknown }[]; [key: string]: unknown };
  };
  "analytics.funnelDefinitions": {
    input: Record<string, never>;
    output: { stages: { key: string; module: string; band: "visit" | "lead" | "interest" | "committed" | "paid" | "returned"; labelKey: string; definitionKey: string; [key: string]: unknown }[]; attribution: { model: "first_touch" | "last_touch"; labelKey: string; definitionKey: string; [key: string]: unknown }[]; [key: string]: unknown };
  };
  "analytics.identify": {
    input: { anonId: string; contactId: string };
    output: { linked: number };
  };
  "analytics.overview": {
    input: { days?: number; includeBots?: boolean };
    output: { days: number; includeBots: boolean; automated: number; views: number; visitors: number; sessions: number; conversions: number; identified: number };
  };
  "analytics.recordExperimentConversion": {
    input: { anonId: string; sessionId: string; contactId?: string; kind: string; amountMinor?: number; currency?: string; path?: string };
    output: { recorded: number; experiments: number };
  };
  "analytics.recordExperimentImpressions": {
    input: { anonId: string; sessionId: string; path?: string; locale?: string; assignments: { [key: string]: string } };
    output: { recorded: number };
  };
  "analytics.recordWebVital": {
    input: { anonId: string; sessionId: string; id: string; metric: "CLS" | "FCP" | "INP" | "LCP" | "TTFB"; value: number; delta: number; rating: "good" | "needs-improvement" | "poor"; navigationType: string };
    output: { recorded: boolean };
  };
  "analytics.topPages": {
    input: { days?: number; includeBots?: boolean; limit?: number };
    output: { path: string; views: number; visitors: number; [key: string]: unknown }[];
  };
  "analytics.topReferrers": {
    input: { days?: number; includeBots?: boolean; limit?: number };
    output: { referrer: string | null; visitors: number; [key: string]: unknown }[];
  };
  "analytics.track": {
    input: { anonId: string; sessionId: string; name: string; eventKey?: string | null; path?: string; referrer?: string | null; locale?: string | null; props?: { [key: string]: unknown }; contactId?: string | null; visitorKind?: "human" | "bot" | "suspected"; botReasons?: string[]; campaign?: { source: string; medium: string | null; campaign: string | null; term: string | null; content: string | null } | null };
    output: { ok: true };
  };
  "analytics.webVitals": {
    input: { days?: number; includeBots?: boolean };
    output: { metric: string; samples: number; p75: number; good: number; needsImprovement: number; poor: number }[];
  };
  "apikeys.create": {
    input: { name: string; scopes?: string[]; expiresInDays?: number };
    output: { id: string; name: string; tokenHash: string; prefix: string; scopes: string[]; createdBy: string | null; lastUsedAt: string | null; expiresAt: string | null; revokedAt: string | null; createdAt: string; updatedAt: string; token: string; [key: string]: unknown };
  };
  "apikeys.list": {
    input: { includeRevoked?: boolean };
    output: { id: string; name: string; prefix: string; scopes: string[]; lastUsedAt: string | null; expiresAt: string | null; revokedAt: string | null; createdAt: string; [key: string]: unknown }[];
  };
  "apikeys.revoke": {
    input: { id: string };
    output: { id: string; name: string; [key: string]: unknown };
  };
  "apikeys.scopes": {
    input: Record<string, never>;
    output: { area: string; family: string; services: { name: string; summary: string; kind: "query" | "mutation"; [key: string]: unknown }[]; [key: string]: unknown }[];
  };
  "assistant.answer": {
    input: { token: string };
    output: { status: "off" | "nothing_to_answer" | "already_attempted" | "refused" | "unconfigured" | "failed" | "answered"; reply: string | null; action: string | null; [key: string]: unknown };
  };
  "assistant.deleteKnowledge": {
    input: { id: string };
    output: { id: string; [key: string]: unknown };
  };
  "assistant.dismissGap": {
    input: { id: string };
    output: { ok: true };
  };
  "assistant.knowledgeGapList": {
    input: { status?: "open" | "saved" | "dismissed" };
    output: { id: string; contactId: string; conversationId: string; question: string; locale: string; reason: "unknown" | "invented"; status: "open" | "saved" | "dismissed"; knowledgeEntryId: string | null; createdAt: string; [key: string]: unknown }[];
  };
  "assistant.knowledgeList": {
    input: Record<string, never>;
    output: { id: string; locale: string; kind: "qa" | "fact" | "policy"; title: string; body: string; enabled: boolean; updatedAt: string; [key: string]: unknown }[];
  };
  "assistant.reindex": {
    input: Record<string, never>;
    output: { chunks: number; [key: string]: unknown };
  };
  "assistant.saveGapAsKnowledge": {
    input: { id: string; title: string; body: string; kind?: "qa" | "fact" | "policy"; locale?: string; enabled?: boolean };
    output: { id: string; locale: string; kind: "qa" | "fact" | "policy"; title: string; body: string; enabled: boolean; updatedAt: string; [key: string]: unknown };
  };
  "assistant.saveKnowledge": {
    input: { id?: string; locale?: string; kind: "qa" | "fact" | "policy"; title: string; body: string; enabled?: boolean };
    output: { id: string; locale: string; kind: "qa" | "fact" | "policy"; title: string; body: string; enabled: boolean; updatedAt: string; [key: string]: unknown };
  };
  "assistant.scopes": {
    input: Record<string, never>;
    output: { action: string; service: string; writes: boolean; description: string; enabled: boolean; available: boolean; [key: string]: unknown }[];
  };
  "assistant.setScope": {
    input: { action: string; enabled: boolean };
    output: { ok: true };
  };
  "assistant.settings": {
    input: Record<string, never>;
    output: { enabled: boolean; provider: "none" | "anthropic" | "openai"; model: string | null; baseUrl: string | null; credentialRef: string | null; credentialPresent: boolean; inputCentsPerMillion: number | null; outputCentsPerMillion: number | null; maxOutputTokens: number; displayName: string | null; spendCapCents: number; spendPeriod: "day" | "week" | "month"; repliesPerConversation: number; repliesPerHour: number; tone: "professional" | "friendly" | "brief"; refuseTopics: string[]; escalateTopics: string[]; contactFormPath: string | null; lastError: string | null; priced: boolean; spentCents: number; remainingCents: number; repliesThisHour: number; ready: boolean; [key: string]: unknown };
  };
  "assistant.turns": {
    input: { limit?: number };
    output: { id: string; conversationId: string; outcome: "answered" | "refused_scope" | "refused_spend" | "refused_rate" | "refused_conversation_cap" | "refused_topic" | "refused_invention" | "unconfigured" | "failed"; detail: string | null; model: string | null; costCents: number; action: string | null; actionAllowed: boolean | null; createdAt: string; [key: string]: unknown }[];
  };
  "assistant.updateSettings": {
    input: { enabled: boolean; provider: "none" | "anthropic" | "openai"; model?: string | null; baseUrl?: string | null; credentialRef?: string | null; inputCentsPerMillion?: number | null; outputCentsPerMillion?: number | null; maxOutputTokens?: number; displayName?: string | null; spendCapCents?: number; spendPeriod?: "day" | "week" | "month"; repliesPerConversation?: number; repliesPerHour?: number; tone?: "professional" | "friendly" | "brief"; refuseTopics?: string[]; escalateTopics?: string[]; contactFormPath?: string | null };
    output: { enabled: boolean; provider: "none" | "anthropic" | "openai"; model: string | null; baseUrl: string | null; credentialRef: string | null; credentialPresent: boolean; inputCentsPerMillion: number | null; outputCentsPerMillion: number | null; maxOutputTokens: number; displayName: string | null; spendCapCents: number; spendPeriod: "day" | "week" | "month"; repliesPerConversation: number; repliesPerHour: number; tone: "professional" | "friendly" | "brief"; refuseTopics: string[]; escalateTopics: string[]; contactFormPath: string | null; lastError: string | null; priced: boolean; spentCents: number; remainingCents: number; repliesThisHour: number; ready: boolean; [key: string]: unknown };
  };
  "audiences.create": {
    input: { name: string; who?: "public" | "token" | "tag" | "signed_in"; contactTag?: string | null; hours?: "calendar" | "custom" | "any"; minNoticeMin?: number | null; bookingHorizonDays?: number | null; bufferBeforeMin?: number | null; bufferAfterMin?: number | null; position?: number };
    output: { id: string; name: string; slug: string; who: "public" | "token" | "tag" | "signed_in"; hasToken: boolean; contactTag: string | null; hours: "calendar" | "custom" | "any"; minNoticeMin: number | null; bookingHorizonDays: number | null; bufferBeforeMin: number | null; bufferAfterMin: number | null; enabled: boolean; position: number; [key: string]: unknown };
  };
  "audiences.link": {
    input: { id: string };
    output: { id: string; token: string };
  };
  "audiences.list": {
    input: Record<string, never>;
    output: { id: string; name: string; slug: string; who: "public" | "token" | "tag" | "signed_in"; hasToken: boolean; contactTag: string | null; hours: "calendar" | "custom" | "any"; minNoticeMin: number | null; bookingHorizonDays: number | null; bufferBeforeMin: number | null; bufferAfterMin: number | null; enabled: boolean; position: number; [key: string]: unknown }[];
  };
  "audiences.remove": {
    input: { id: string };
    output: { id: string };
  };
  "audiences.rotateLink": {
    input: { id: string };
    output: { id: string; token: string };
  };
  "audiences.setCalendars": {
    input: { id: string; calendarIds: string[] };
    output: { id: string; calendars: number };
  };
  "audiences.setHours": {
    input: { id: string; hours: "calendar" | "custom" | "any"; rules?: { weekday: number; starts: string; ends: string }[] };
    output: { id: string; hours: "calendar" | "custom" | "any"; rules: number };
  };
  "audiences.setServices": {
    input: { id: string; serviceOfferingIds: string[] };
    output: { id: string; services: number };
  };
  "auth.beginTotpEnrollment": {
    input: Record<string, never>;
    output: { enrollmentToken: string; secret: string; uri: string; [key: string]: unknown };
  };
  "auth.beginWebAuthnRegistration": {
    input: Record<string, never>;
    output: { registrationToken: string; options: unknown; [key: string]: unknown };
  };
  "auth.beginWebAuthnStepUp": {
    input: Record<string, never>;
    output: { verificationToken: string; options: unknown; [key: string]: unknown };
  };
  "auth.changePassword": {
    input: { currentPassword: string; newPassword: string; keepSessionToken?: string };
    output: { ok: true; otherSessionsRevoked: number };
  };
  "auth.completeTwoFactorLogin": {
    input: { challengeToken: string; code: string };
    output: { userId: string; method: "totp" | "recovery"; [key: string]: unknown } & { token: string; sessionId: string; expiresAt: string; [key: string]: unknown };
  };
  "auth.completeWebAuthnLogin": {
    input: { challengeToken: string; credentialResponse: { [key: string]: unknown } };
    output: { userId: string; method: "webauthn"; [key: string]: unknown } & { token: string; sessionId: string; expiresAt: string; [key: string]: unknown };
  };
  "auth.confirmTotpEnrollment": {
    input: { enrollmentToken: string; code: string };
    output: { ok: true; recoveryCodes: string[] };
  };
  "auth.consumeCustomerMagicLink": {
    input: { token: string };
    output: { contactId: string; userId: string; linked: boolean; defaultLocale: string; enabledLocales: string[]; locale: string; token: string; sessionId: string; expiresAt: string; [key: string]: unknown };
  };
  "auth.finishWebAuthnRegistration": {
    input: { registrationToken: string; name?: string; credentialResponse: { [key: string]: unknown } };
    output: { ok: true; recoveryCodes: string[] };
  };
  "auth.finishWebAuthnStepUp": {
    input: { verificationToken: string; credentialResponse: { [key: string]: unknown } };
    output: { ok: true };
  };
  "auth.listSessions": {
    input: Record<string, never>;
    output: { id: string; ipHint: string | null; createdAt: string; lastSeenAt: string; expiresAt: string; twoFactorVerifiedAt: string | null; deviceLabel: string; current: boolean; [key: string]: unknown }[];
  };
  "auth.login": {
    input: { email: string; password: string };
    output: { userId: string; role: string; twoFactorRequired: boolean; token: string; expiresAt: string; [key: string]: unknown };
  };
  "auth.loginChallengeDetails": {
    input: { challengeToken: string };
    output: { methods: { totp: boolean; recovery: boolean; webauthn: boolean }; webauthnOptions?: unknown; [key: string]: unknown };
  };
  "auth.logout": {
    input: { token: string };
    output: { ok: true };
  };
  "auth.recentLoginSecurity": {
    input: { limit?: number };
    output: { id: string; sessionId: string; deviceLabel: string; ipHint: string | null; reason: ("new_device" | "new_network") | null; noticeStatus: "not_needed" | "pending" | "sent" | "failed" | "unavailable"; createdAt: string; [key: string]: unknown }[];
  };
  "auth.regenerateRecoveryCodes": {
    input: Record<string, never>;
    output: { recoveryCodes: string[]; [key: string]: unknown };
  };
  "auth.registerOwner": {
    input: { email: string; password: string };
    output: { userId: string; [key: string]: unknown } & { token: string; sessionId: string; expiresAt: string; [key: string]: unknown };
  };
  "auth.removeTotpFactor": {
    input: Record<string, never>;
    output: { ok: true };
  };
  "auth.removeWebAuthnFactor": {
    input: { id: string };
    output: { ok: true };
  };
  "auth.requestCustomerMagicLink": {
    input: { email: string; locale?: string };
    output: { ok: true; message: string };
  };
  "auth.requestPasswordReset": {
    input: { email: string };
    output: { ok: true };
  };
  "auth.resetPassword": {
    input: { token: string; newPassword: string };
    output: { ok: true; sessionsRevoked: number };
  };
  "auth.revokeOtherSessions": {
    input: Record<string, never>;
    output: { ok: true; revoked: number };
  };
  "auth.revokeSession": {
    input: { id: string };
    output: { ok: true; current: boolean };
  };
  "auth.twoFactorStatus": {
    input: Record<string, never>;
    output: { email: string; required: boolean; verified: boolean; stepUpValid: boolean; totp: { createdAt: string; [key: string]: unknown } | null; webauthn: { id: string; userId: string; credentialId: string; name: string; counter: number; transports: string[]; deviceType: string; backedUp: boolean; lastUsedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[]; recoveryCodesRemaining: number; [key: string]: unknown };
  };
  "auth.verifyStepUpCode": {
    input: { code: string };
    output: { ok: true; method: "totp" | "recovery" };
  };
  "auth.whoami": {
    input: { token: string };
    output: { userId: string; role: string; email: string; sessionId: string; expiresAt: string; [key: string]: unknown };
  };
  "automations.checkGuardrails": {
    input: { verb: string; contactId?: string | null; autonomyCeiling?: ("suggest" | "approve" | "autonomous") | null; inputTrust?: "owner" | "system" | "untrusted"; intent?: "transactional" | "marketing"; costMinor?: number; budgetRemainingMinor?: number | null };
    output: { decision: "proceed" | "approve" | "refuse" | "defer"; reason: string | null; until: string | null; [key: string]: unknown };
  };
  "automations.get": {
    input: { automationId: string };
    output: { automation: { id: string; name: string; description: string; triggerKind: "event" | "schedule" | "manual"; eventPattern: string | null; scheduleCron: string | null; timezone: string | null; entrySegmentId: string | null; status: "draft" | "active" | "paused" | "archived"; currentVersionId: string | null; autonomyCeiling: ("suggest" | "approve" | "autonomous") | null; budgetMinor: number | null; reentry: "once" | "cooldown" | "always"; cooldownDays: number | null; updatedAt: string; [key: string]: unknown }; draftGraph: unknown | null; currentGraph: unknown | null; problems: { nodeId: string | null; message: string; [key: string]: unknown }[]; [key: string]: unknown };
  };
  "automations.inspectRun": {
    input: { runId: string };
    output: { run: { id: string; subjectId: string; subjectVersionId: string | null; contactId: string | null; status: "running" | "done" | "failed" | "cancelled"; stopReason: ("done" | "budget" | "timeout" | "refused" | "error" | "cancelled" | "bounds") | null; stepCount: number; resumeNodeId: string | null; wakeAt: string | null; startedAt: string; endedAt: string | null; error: string | null; [key: string]: unknown }; steps: { seq: number; kind: string; nodeId: string | null; serviceName: string | null; output: unknown; error: string | null; at: string; [key: string]: unknown }[]; [key: string]: unknown };
  };
  "automations.killRun": {
    input: { runId: string; reason?: string | null };
    output: { runId: string; status: string; [key: string]: unknown };
  };
  "automations.list": {
    input: { status?: "draft" | "active" | "paused" | "archived"; triggerKind?: "event" | "schedule" | "manual"; limit?: number };
    output: { id: string; name: string; description: string; triggerKind: "event" | "schedule" | "manual"; eventPattern: string | null; scheduleCron: string | null; timezone: string | null; entrySegmentId: string | null; status: "draft" | "active" | "paused" | "archived"; currentVersionId: string | null; autonomyCeiling: ("suggest" | "approve" | "autonomous") | null; budgetMinor: number | null; reentry: "once" | "cooldown" | "always"; cooldownDays: number | null; updatedAt: string; [key: string]: unknown }[];
  };
  "automations.publish": {
    input: { automationId: string; note?: string | null; activate?: boolean };
    output: { versionId: string; version: number; status: "draft" | "active" | "paused" | "archived"; [key: string]: unknown };
  };
  "automations.restoreVersion": {
    input: { versionId: string };
    output: { automationId: string; fromVersion: number; [key: string]: unknown };
  };
  "automations.run": {
    input: { automationId: string; contactId?: string | null };
    output: { started: boolean; reason: string | null; runId: string | null; state: string | null; [key: string]: unknown };
  };
  "automations.runs": {
    input: { automationId?: string; status?: "running" | "done" | "failed" | "cancelled"; limit?: number };
    output: { id: string; subjectId: string; subjectVersionId: string | null; contactId: string | null; status: "running" | "done" | "failed" | "cancelled"; stopReason: ("done" | "budget" | "timeout" | "refused" | "error" | "cancelled" | "bounds") | null; stepCount: number; resumeNodeId: string | null; wakeAt: string | null; startedAt: string; endedAt: string | null; error: string | null; [key: string]: unknown }[];
  };
  "automations.save": {
    input: { id?: string; name: string; description?: string; triggerKind?: "event" | "schedule" | "manual"; eventPattern?: string | null; scheduleCron?: string | null; timezone?: string | null; entrySegmentId?: string | null; autonomyCeiling?: ("suggest" | "approve" | "autonomous") | null; budgetMinor?: number | null; reentry?: "once" | "cooldown" | "always"; cooldownDays?: number | null; draftGraph?: unknown };
    output: { id: string; name: string; description: string; triggerKind: "event" | "schedule" | "manual"; eventPattern: string | null; scheduleCron: string | null; timezone: string | null; entrySegmentId: string | null; status: "draft" | "active" | "paused" | "archived"; currentVersionId: string | null; autonomyCeiling: ("suggest" | "approve" | "autonomous") | null; budgetMinor: number | null; reentry: "once" | "cooldown" | "always"; cooldownDays: number | null; updatedAt: string; [key: string]: unknown };
  };
  "automations.setStatus": {
    input: { automationId: string; status: "active" | "paused" | "archived" };
    output: { automationId: string; status: "draft" | "active" | "paused" | "archived"; [key: string]: unknown };
  };
  "automations.triggers": {
    input: Record<string, never>;
    output: { name: string; module: string; [key: string]: unknown }[];
  };
  "automations.validate": {
    input: { graph: unknown; triggerKind?: "event" | "schedule" | "manual"; entrySegmentId?: string | null };
    output: { ok: boolean; problems: { nodeId: string | null; message: string; [key: string]: unknown }[]; [key: string]: unknown };
  };
  "automations.verbs": {
    input: Record<string, never>;
    output: { key: string; module: string; label: string; summary: string; effect: "record" | "messages" | "money" | "destructive"; requiresContact: boolean; [key: string]: unknown }[];
  };
  "automations.versionGraph": {
    input: { versionId: string };
    output: { versionId: string; version: number; graph: unknown; [key: string]: unknown };
  };
  "automations.versions": {
    input: { automationId: string };
    output: { id: string; version: number; note: string | null; triggerKind: "event" | "schedule" | "manual"; eventPattern: string | null; createdAt: string; [key: string]: unknown }[];
  };
  "availability.addException": {
    input: { calendarId: string; startsOn: string; endsOn?: string; kind: "closed" | "open" | "reduced"; starts?: string | null; ends?: string | null; reason?: string | null };
    output: { id: string; calendarId: string; startsOn: string; endsOn: string; kind: "closed" | "open" | "reduced"; starts: string | null; ends: string | null; reason: string | null; [key: string]: unknown };
  };
  "availability.copyDay": {
    input: { calendarId: string; fromWeekday: number; toWeekdays: number[] };
    output: { calendarId: string; copied: number };
  };
  "availability.removeException": {
    input: { id: string };
    output: { id: string };
  };
  "availability.rules": {
    input: { calendarId: string };
    output: { rules: { id: string; calendarId: string; weekday: number; starts: string; ends: string; effectiveFrom: string | null; effectiveTo: string | null; kind: "bookable" | "on_call" | "admin"; [key: string]: unknown }[]; exceptions: { id: string; calendarId: string; startsOn: string; endsOn: string; kind: "closed" | "open" | "reduced"; starts: string | null; ends: string | null; reason: string | null; [key: string]: unknown }[] };
  };
  "availability.setRules": {
    input: { calendarId: string; rules: { weekday: number; starts: string; ends: string; effectiveFrom?: string | null; effectiveTo?: string | null; kind?: "bookable" | "on_call" | "admin" }[] };
    output: { calendarId: string; rules: number };
  };
  "availability.windows": {
    input: { calendarId: string; from: string; to: string; kinds?: ("bookable" | "on_call" | "admin")[] };
    output: { startsAt: string; endsAt: string; kind: "bookable" | "on_call" | "admin" }[];
  };
  "bookings.addParticipant": {
    input: { bookingId: string; email?: string; name?: string; seatCount?: number };
    output: { id: string; contactId: string | null; name: string | null; status: "registered" | "attended" | "no_show"; seatCount: number; [key: string]: unknown };
  };
  "bookings.addReminder": {
    input: { bookingId: string; channel?: "email" | "sms"; offsetMin: number };
    output: { id: string; bookingId: string; channel: "email" | "sms"; offsetMin: number; sendAt: string; sentAt: string | null; status: "scheduled" | "sent" | "skipped" | "failed"; skipReason: string | null; [key: string]: unknown };
  };
  "bookings.attachIntake": {
    input: { id: string; submissionId: string };
    output: { id: string; intakeSubmissionId: string | null; [key: string]: unknown };
  };
  "bookings.attachIntakeByToken": {
    input: { token: string; submissionId: string };
    output: { id: string; [key: string]: unknown };
  };
  "bookings.byToken": {
    input: { token: string };
    output: { id: string; startsAt: string; endsAt: string; timezoneAtBooking: string; status: "requested" | "confirmed" | "in_progress" | "completed" | "no_show" | "cancelled"; calendarId: string; calendarName: string; locationDetail: string | null; mayReschedule: boolean; mayCancel: boolean; refusal: string | null; policyName: string | null; intakeFormId: string | null; waiverToken: string | null; [key: string]: unknown } | null;
  };
  "bookings.cancelByToken": {
    input: { token: string; reason?: string };
    output: { id: string; outcome: { free: boolean; feeMinor: number; refundDueMinor: number; outstandingMinor: number; forfeitsDeposit: boolean; paidMinor: number; valueMinor: number; currency: string | null; policyName: string; reason: string; decidedAt: string } | null };
  };
  "bookings.cancelReminder": {
    input: { id: string };
    output: { id: string; [key: string]: unknown };
  };
  "bookings.create": {
    input: { calendarId: string; contact: { email: string; name?: string; phone?: string }; serviceOfferingId?: string | null; secondaryCalendarIds?: string[]; startsAt: string; endsAt: string; capacityUsed?: number; locationId?: string | null; locationDetail?: string | null; source?: "site" | "admin" | "agent" | "import"; notes?: string | null; status?: "requested" | "confirmed" };
    output: { id: string; contactId: string; serviceOfferingId: string | null; calendarId: string; secondaryCalendarIds: string[]; startsAt: string; endsAt: string; timezoneAtBooking: string; status: "requested" | "confirmed" | "in_progress" | "completed" | "no_show" | "cancelled"; locationId: string | null; locationDetail: string | null; capacityUsed: number; exclusive: boolean; invoiceId: string | null; rescheduledFromId: string | null; rescheduleCount: number; cancellationPolicy: { name: string; freeUntilHours: number; feeType: "none" | "fixed" | "percent" | "forfeit_deposit"; feeValue: number | null; rescheduleLimit: number; noShowFeeMinor: number } | null; cancellationOutcome: { free: boolean; feeMinor: number; refundDueMinor: number; outstandingMinor: number; forfeitsDeposit: boolean; paidMinor: number; valueMinor: number; currency: string | null; policyName: string; reason: string; decidedAt: string } | null; intakeSubmissionId: string | null; waiverId: string | null; source: "site" | "admin" | "agent" | "import"; notes: string | null; cancellationReason: string | null; [key: string]: unknown };
  };
  "bookings.get": {
    input: { id: string };
    output: { id: string; contactId: string; serviceOfferingId: string | null; calendarId: string; secondaryCalendarIds: string[]; startsAt: string; endsAt: string; timezoneAtBooking: string; status: "requested" | "confirmed" | "in_progress" | "completed" | "no_show" | "cancelled"; locationId: string | null; locationDetail: string | null; capacityUsed: number; exclusive: boolean; invoiceId: string | null; rescheduledFromId: string | null; rescheduleCount: number; cancellationPolicy: { name: string; freeUntilHours: number; feeType: "none" | "fixed" | "percent" | "forfeit_deposit"; feeValue: number | null; rescheduleLimit: number; noShowFeeMinor: number } | null; cancellationOutcome: { free: boolean; feeMinor: number; refundDueMinor: number; outstandingMinor: number; forfeitsDeposit: boolean; paidMinor: number; valueMinor: number; currency: string | null; policyName: string; reason: string; decidedAt: string } | null; intakeSubmissionId: string | null; waiverId: string | null; source: "site" | "admin" | "agent" | "import"; notes: string | null; cancellationReason: string | null; participants: { id: string; contactId: string | null; name: string | null; status: "registered" | "attended" | "no_show"; seatCount: number; [key: string]: unknown }[]; [key: string]: unknown } | null;
  };
  "bookings.ics": {
    input: { token: string };
    output: { body: string } | null;
  };
  "bookings.issueWaiver": {
    input: { id: string };
    output: { contractId: string | null; reason: string | null; [key: string]: unknown };
  };
  "bookings.list": {
    input: { calendarId?: string; contactId?: string; from?: string; to?: string; statuses?: ("requested" | "confirmed" | "in_progress" | "completed" | "no_show" | "cancelled")[]; limit?: number };
    output: { id: string; contactId: string; serviceOfferingId: string | null; calendarId: string; secondaryCalendarIds: string[]; startsAt: string; endsAt: string; timezoneAtBooking: string; status: "requested" | "confirmed" | "in_progress" | "completed" | "no_show" | "cancelled"; locationId: string | null; locationDetail: string | null; capacityUsed: number; exclusive: boolean; invoiceId: string | null; rescheduledFromId: string | null; rescheduleCount: number; intakeSubmissionId: string | null; waiverId: string | null; source: "site" | "admin" | "agent" | "import"; notes: string | null; cancellationReason: string | null; contactName: string | null; contactEmail: string | null; calendarName: string; [key: string]: unknown }[];
  };
  "bookings.reminders": {
    input: { bookingId: string };
    output: { id: string; bookingId: string; channel: "email" | "sms"; offsetMin: number; sendAt: string; sentAt: string | null; status: "scheduled" | "sent" | "skipped" | "failed"; skipReason: string | null; [key: string]: unknown }[];
  };
  "bookings.removeParticipant": {
    input: { id: string };
    output: { id: string; bookingId: string; seatsReleased: number };
  };
  "bookings.requirements": {
    input: { id: string };
    output: { intakeFormId: string | null; waiverOutstanding: boolean; waiverTitle: string | null; ready: boolean; [key: string]: unknown } | null;
  };
  "bookings.reschedule": {
    input: { id: string; startsAt: string; endsAt: string; calendarId?: string; reason?: string | null; overridePolicy?: boolean };
    output: { id: string; contactId: string; serviceOfferingId: string | null; calendarId: string; secondaryCalendarIds: string[]; startsAt: string; endsAt: string; timezoneAtBooking: string; status: "requested" | "confirmed" | "in_progress" | "completed" | "no_show" | "cancelled"; locationId: string | null; locationDetail: string | null; capacityUsed: number; exclusive: boolean; invoiceId: string | null; rescheduledFromId: string | null; rescheduleCount: number; cancellationPolicy: { name: string; freeUntilHours: number; feeType: "none" | "fixed" | "percent" | "forfeit_deposit"; feeValue: number | null; rescheduleLimit: number; noShowFeeMinor: number } | null; cancellationOutcome: { free: boolean; feeMinor: number; refundDueMinor: number; outstandingMinor: number; forfeitsDeposit: boolean; paidMinor: number; valueMinor: number; currency: string | null; policyName: string; reason: string; decidedAt: string } | null; intakeSubmissionId: string | null; waiverId: string | null; source: "site" | "admin" | "agent" | "import"; notes: string | null; cancellationReason: string | null; [key: string]: unknown };
  };
  "bookings.rescheduleByToken": {
    input: { token: string; startsAt: string; endsAt: string };
    output: { id: string; startsAt: string; endsAt: string; timezoneAtBooking: string; status: "requested" | "confirmed" | "in_progress" | "completed" | "no_show" | "cancelled"; calendarId: string; calendarName: string; locationDetail: string | null; mayReschedule: boolean; mayCancel: boolean; refusal: string | null; policyName: string | null; intakeFormId: string | null; waiverToken: string | null; [key: string]: unknown };
  };
  "bookings.setParticipantStatus": {
    input: { id: string; status: "registered" | "attended" | "no_show" };
    output: { id: string; bookingId: string; status: "registered" | "attended" | "no_show"; [key: string]: unknown };
  };
  "bookings.setStatus": {
    input: { id: string; status: "requested" | "confirmed" | "in_progress" | "completed" | "no_show" | "cancelled"; reason?: string | null; overrideRequirements?: boolean };
    output: { id: string; contactId: string; serviceOfferingId: string | null; calendarId: string; secondaryCalendarIds: string[]; startsAt: string; endsAt: string; timezoneAtBooking: string; status: "requested" | "confirmed" | "in_progress" | "completed" | "no_show" | "cancelled"; locationId: string | null; locationDetail: string | null; capacityUsed: number; exclusive: boolean; invoiceId: string | null; rescheduledFromId: string | null; rescheduleCount: number; cancellationPolicy: { name: string; freeUntilHours: number; feeType: "none" | "fixed" | "percent" | "forfeit_deposit"; feeValue: number | null; rescheduleLimit: number; noShowFeeMinor: number } | null; cancellationOutcome: { free: boolean; feeMinor: number; refundDueMinor: number; outstandingMinor: number; forfeitsDeposit: boolean; paidMinor: number; valueMinor: number; currency: string | null; policyName: string; reason: string; decidedAt: string } | null; intakeSubmissionId: string | null; waiverId: string | null; source: "site" | "admin" | "agent" | "import"; notes: string | null; cancellationReason: string | null; [key: string]: unknown };
  };
  "briefing.markRead": {
    input: { id: string };
    output: { id: string; readAt: string | null };
  };
  "briefing.recent": {
    input: Record<string, never>;
    output: { id: string; onDate: string; status: "assembling" | "ready" | "failed"; readAt: string | null; sections: number }[];
  };
  "briefing.setSection": {
    input: { key: string; enabled: boolean };
    output: { key: string; enabled: boolean; [key: string]: unknown };
  };
  "briefing.today": {
    input: { onDate?: string };
    output: { id: string; onDate: string; status: "assembling" | "ready" | "failed"; assembledAt: string | null; readAt: string | null; sections: { key: string; source: "core" | "module" | "playbook"; title: string; body: string | null; items: { label: string; href?: string; detail?: string }[]; severity: "attention" | "today" | "changed"; playbookRunId: string | null }[]; hidden: { key: string; title: string }[] } | null;
  };
  "broadcasts.list": {
    input: { status?: "draft" | "scheduled" | "sending" | "sent" | "paused" | "cancelled"; limit?: number };
    output: { id: string; name: string; templateId: string; segmentId: string; subject: string | null; status: "draft" | "scheduled" | "sending" | "sent" | "paused" | "cancelled"; scheduledAt: string | null; startedAt: string | null; finishedAt: string | null; audienceCount: number; updatedAt: string; [key: string]: unknown }[];
  };
  "broadcasts.pause": {
    input: { id: string; cancel?: boolean };
    output: { broadcastId: string; status: "draft" | "scheduled" | "sending" | "sent" | "paused" | "cancelled"; [key: string]: unknown };
  };
  "broadcasts.recipients": {
    input: { id: string; state?: "pending" | "sent" | "failed" | "suppressed" | "bounced" | "complained"; limit?: number };
    output: { contactId: string; email: string; state: "pending" | "sent" | "failed" | "suppressed" | "bounced" | "complained"; detail: string | null; sentAt: string | null; [key: string]: unknown }[];
  };
  "broadcasts.resume": {
    input: { id: string };
    output: { broadcastId: string; remaining: number; [key: string]: unknown };
  };
  "broadcasts.save": {
    input: { id?: string; name: string; templateId: string; segmentId: string; subject?: string | null; scheduledAt?: string | null };
    output: { id: string; name: string; templateId: string; segmentId: string; subject: string | null; status: "draft" | "scheduled" | "sending" | "sent" | "paused" | "cancelled"; scheduledAt: string | null; startedAt: string | null; finishedAt: string | null; audienceCount: number; updatedAt: string; [key: string]: unknown };
  };
  "broadcasts.start": {
    input: { id: string };
    output: { broadcastId: string; audience: number; [key: string]: unknown };
  };
  "broadcasts.stats": {
    input: { id: string };
    output: { audience: number; pending: number; sent: number; failed: number; suppressed: number; bounced: number; complained: number; [key: string]: unknown };
  };
  "broadcasts.testSend": {
    input: { templateId: string; to: string; subject?: string | null; variables?: { [key: string]: string } };
    output: { sent: boolean; subject: string; [key: string]: unknown };
  };
  "builder.apply": {
    input: { id: string };
    output: { applied: false; status: "stale"; message: string } | { applied: true; status: "applied"; proposal: { id: string; brief: string; lane: "structure" | "vocabulary" | "refused"; status: "ready" | "applied" | "rejected" | "stale" | "rolled_back"; summary: string; rationale: string; baseSnapshot: unknown; changes: unknown; diff: unknown; applyResult: unknown; model: string; provider: string | null; inputTokens: number; outputTokens: number; totalTokens: number; createdByActor: string; appliedAt: string | null; rolledBackAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown } };
  };
  "builder.codeStatus": {
    input: Record<string, never>;
    output: { adapterConfigured: boolean; repository: string | null; baseBranch: string | null; canOpenPullRequests: boolean };
  };
  "builder.deliverCode": {
    input: { id: string; as?: "pull_request" | "patch" };
    output: { id: string; brief: string; pluginName: string; status: "ready" | "refused" | "delivered" | "rejected"; summary: string; rationale: string; files: unknown; gates: unknown; diff: unknown; deliveredAs: ("pull_request" | "patch") | null; pullRequestUrl: string | null; branch: string | null; refusalReason: string | null; model: string; provider: string | null; inputTokens: number; outputTokens: number; totalTokens: number; createdByActor: string; deliveredAt: string | null; patch: string | null; [key: string]: unknown };
  };
  "builder.getCodeProposal": {
    input: { id: string };
    output: { id: string; brief: string; pluginName: string; status: "ready" | "refused" | "delivered" | "rejected"; summary: string; rationale: string; files: unknown; gates: unknown; diff: unknown; deliveredAs: ("pull_request" | "patch") | null; pullRequestUrl: string | null; branch: string | null; refusalReason: string | null; model: string; provider: string | null; inputTokens: number; outputTokens: number; totalTokens: number; createdByActor: string; deliveredAt: string | null; patch: string; [key: string]: unknown } | null;
  };
  "builder.getProposal": {
    input: { id: string };
    output: { id: string; brief: string; lane: "structure" | "vocabulary" | "refused"; status: "ready" | "applied" | "rejected" | "stale" | "rolled_back"; summary: string; rationale: string; baseSnapshot: unknown; changes: unknown; diff: unknown; applyResult: unknown; model: string; provider: string | null; inputTokens: number; outputTokens: number; totalTokens: number; createdByActor: string; appliedAt: string | null; rolledBackAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "builder.listCodeProposals": {
    input: { limit?: number };
    output: { id: string; brief: string; pluginName: string; status: "ready" | "refused" | "delivered" | "rejected"; summary: string; rationale: string; files: unknown; gates: unknown; diff: unknown; deliveredAs: ("pull_request" | "patch") | null; pullRequestUrl: string | null; branch: string | null; refusalReason: string | null; model: string; provider: string | null; inputTokens: number; outputTokens: number; totalTokens: number; createdByActor: string; deliveredAt: string | null; [key: string]: unknown }[];
  };
  "builder.listProposals": {
    input: { limit?: number };
    output: { id: string; brief: string; lane: "structure" | "vocabulary" | "refused"; status: "ready" | "applied" | "rejected" | "stale" | "rolled_back"; summary: string; rationale: string; baseSnapshot: unknown; changes: unknown; diff: unknown; applyResult: unknown; model: string; provider: string | null; inputTokens: number; outputTokens: number; totalTokens: number; createdByActor: string; appliedAt: string | null; rolledBackAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "builder.propose": {
    input: { brief: string };
    output: { id: string; brief: string; lane: "structure" | "vocabulary" | "refused"; status: "ready" | "applied" | "rejected" | "stale" | "rolled_back"; summary: string; rationale: string; baseSnapshot: unknown; changes: unknown; diff: unknown; applyResult: unknown; model: string; provider: string | null; inputTokens: number; outputTokens: number; totalTokens: number; createdByActor: string; appliedAt: string | null; rolledBackAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "builder.proposeCode": {
    input: { brief: string };
    output: { id: string; brief: string; pluginName: string; status: "ready" | "refused" | "delivered" | "rejected"; summary: string; rationale: string; files: unknown; gates: unknown; diff: unknown; deliveredAs: ("pull_request" | "patch") | null; pullRequestUrl: string | null; branch: string | null; refusalReason: string | null; model: string; provider: string | null; inputTokens: number; outputTokens: number; totalTokens: number; createdByActor: string; deliveredAt: string | null; [key: string]: unknown };
  };
  "builder.reject": {
    input: { id: string };
    output: { id: string; brief: string; lane: "structure" | "vocabulary" | "refused"; status: "ready" | "applied" | "rejected" | "stale" | "rolled_back"; summary: string; rationale: string; baseSnapshot: unknown; changes: unknown; diff: unknown; applyResult: unknown; model: string; provider: string | null; inputTokens: number; outputTokens: number; totalTokens: number; createdByActor: string; appliedAt: string | null; rolledBackAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "builder.rejectCode": {
    input: { id: string };
    output: { id: string; status: string };
  };
  "builder.rollback": {
    input: { id: string };
    output: { applied: false; status: "stale"; message: string } | { id: string; brief: string; lane: "structure" | "vocabulary" | "refused"; status: "ready" | "applied" | "rejected" | "stale" | "rolled_back"; summary: string; rationale: string; baseSnapshot: unknown; changes: unknown; diff: unknown; applyResult: unknown; model: string; provider: string | null; inputTokens: number; outputTokens: number; totalTokens: number; createdByActor: string; appliedAt: string | null; rolledBackAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "builder.status": {
    input: Record<string, never>;
    output: { adapter: string; configured: boolean; monthlyTokenBudget: number; usedTokens: number; remainingTokens: number; maxOutputTokensPerProposal: number };
  };
  "calendars.archive": {
    input: { id: string; archived?: boolean };
    output: { id: string; status: "active" | "archived" };
  };
  "calendars.create": {
    input: { kind: "person" | "business" | "resource"; userId?: string | null; name: string; slug?: string; timezone?: string; locationId?: string | null; capacityDefault?: number; colour?: string | null; externalCalendarId?: string | null; bookingHorizonDays?: number; minNoticeMin?: number; maxPerDay?: number | null };
    output: { id: string; kind: "person" | "business" | "resource"; name: string; slug: string; userId: string | null; locationId: string | null; timezone: string; capacityDefault: number; colour: string | null; externalCalendarId: string | null; bookingHorizonDays: number; minNoticeMin: number; maxPerDay: number | null; status: "active" | "archived"; [key: string]: unknown };
  };
  "calendars.feed": {
    input: { token: string };
    output: { name: string; body: string } | null;
  };
  "calendars.forService": {
    input: { serviceOfferingId: string };
    output: { id: string; calendarId: string; name: string; kind: "person" | "business" | "resource"; timezone: string; role: "primary" | "assistant" | "resource"; priority: number; skillLevel: string | null; capacityDefault: number; status: "active" | "archived"; [key: string]: unknown }[];
  };
  "calendars.get": {
    input: { id: string };
    output: { id: string; kind: "person" | "business" | "resource"; name: string; slug: string; userId: string | null; locationId: string | null; timezone: string; capacityDefault: number; colour: string | null; externalCalendarId: string | null; bookingHorizonDays: number; minNoticeMin: number; maxPerDay: number | null; status: "active" | "archived"; memberships: { id: string; serviceOfferingId: string; role: "primary" | "assistant" | "resource"; priority: number; skillLevel: string | null; [key: string]: unknown }[]; [key: string]: unknown } | null;
  };
  "calendars.issueFeed": {
    input: { id: string };
    output: { id: string; token: string };
  };
  "calendars.list": {
    input: { kind?: "person" | "business" | "resource"; includeArchived?: boolean };
    output: { id: string; kind: "person" | "business" | "resource"; name: string; slug: string; userId: string | null; locationId: string | null; timezone: string; capacityDefault: number; colour: string | null; externalCalendarId: string | null; bookingHorizonDays: number; minNoticeMin: number; maxPerDay: number | null; status: "active" | "archived"; [key: string]: unknown }[];
  };
  "calendars.revokeFeed": {
    input: { id: string };
    output: { id: string };
  };
  "calendars.setForService": {
    input: { serviceOfferingId: string; members: { calendarId: string; role?: "primary" | "assistant" | "resource"; priority?: number; skillLevel?: string | null }[] };
    output: { serviceOfferingId: string; members: number };
  };
  "calendars.setIcsImport": {
    input: { id: string; url?: string | null };
    output: { id: string; url: string | null };
  };
  "calendars.update": {
    input: { id: string; name?: string; slug?: string; timezone?: string; locationId?: string | null; capacityDefault?: number; colour?: string | null; externalCalendarId?: string | null; bookingHorizonDays?: number; minNoticeMin?: number; maxPerDay?: number | null; status?: "active" | "archived" };
    output: { id: string; kind: "person" | "business" | "resource"; name: string; slug: string; userId: string | null; locationId: string | null; timezone: string; capacityDefault: number; colour: string | null; externalCalendarId: string | null; bookingHorizonDays: number; minNoticeMin: number; maxPerDay: number | null; status: "active" | "archived"; [key: string]: unknown };
  };
  "catalog.abandonStaleCarts": {
    input: Record<string, never>;
    output: { abandoned: number };
  };
  "catalog.activateProduct": {
    input: { id: string; expectedVersion: number };
    output: { id: string; name: string; slug: string; kind: "physical" | "digital" | "service" | "rental" | "bundle" | "pass"; subtitle: string | null; description: unknown; brand: string | null; status: "draft" | "active" | "archived"; visibility: "public" | "unlisted" | "member_only"; taxCategoryId: string | null; seo: unknown; workingName: string | null; workingSubtitle: string | null; workingDescription: unknown | null; workingSeo: unknown | null; schemaType: string; publishedAt: string | null; archivedAt: string | null; version: number; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "catalog.addBundleComponent": {
    input: { productId: string; expectedVersion: number; componentVariantId: string; quantity?: number; priceMode?: "sum" | "fixed" | "percent_off"; amount?: string; percentOffPpm?: number; currency?: string };
    output: { id: string; name: string; slug: string; kind: "physical" | "digital" | "service" | "rental" | "bundle" | "pass"; subtitle: string | null; description: unknown; brand: string | null; status: "draft" | "active" | "archived"; visibility: "public" | "unlisted" | "member_only"; taxCategoryId: string | null; seo: unknown; workingName: string | null; workingSubtitle: string | null; workingDescription: unknown | null; workingSeo: unknown | null; schemaType: string; publishedAt: string | null; archivedAt: string | null; version: number; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "catalog.addCartItem": {
    input: { cartId: string; variantId: string; quantity?: number; locationId?: string; galleryId?: string; assetId?: string };
    output: { cart: { id: string; token: string; contactId: string | null; currency: string; kind: "cart" | "saved"; status: "open" | "converted" | "abandoned"; name: string | null; lastActivityAt: string; abandonedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }; lines: { id: string; cartId: string; variantId: string; locationId: string | null; quantity: number; reservationId: string | null; galleryId: string | null; assetId: string | null; createdAt: string; updatedAt: string; sku: string; productName: string; requiresShipping: boolean; weightG: number | null; lengthMm: number | null; widthMm: number | null; heightMm: number | null; unitAmountMinor: number | null; lineTotalMinor: number | null; priceAvailable: boolean; priceReason: string | null; stock: { tracked: false; available: boolean; quantity?: number } | { tracked: true; available: boolean; backordered: boolean; restockAt: string | null; onHand: number; reserved: number; incoming: number; canPromise: number }; [key: string]: unknown }[]; subtotalMinor: number; allPriced: boolean; allAvailable: boolean };
  };
  "catalog.addOptionValue": {
    input: { optionTypeId: string; name: string; skuFragment: string; position?: number };
    output: { id: string; optionTypeId: string; name: string; skuFragment: string; position: number; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "catalog.addProductRelation": {
    input: { productId: string; expectedVersion: number; relatedProductId: string; kind: "upsell" | "cross_sell" | "accessory" | "replacement" | "variant_of" };
    output: { id: string; name: string; slug: string; kind: "physical" | "digital" | "service" | "rental" | "bundle" | "pass"; subtitle: string | null; description: unknown; brand: string | null; status: "draft" | "active" | "archived"; visibility: "public" | "unlisted" | "member_only"; taxCategoryId: string | null; seo: unknown; workingName: string | null; workingSubtitle: string | null; workingDescription: unknown | null; workingSeo: unknown | null; schemaType: string; publishedAt: string | null; archivedAt: string | null; version: number; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "catalog.addPurchaseOrderLine": {
    input: { purchaseOrderId: string; variantId: string; quantity: number; unitCost: string };
    output: { id: string; purchaseOrderId: string; variantId: string; quantity: number; receivedQty: number; unitCostMinor: number; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "catalog.addShippingRateBand": {
    input: { methodId: string; currency: string; minValue: number; maxValue?: number; amount: string; perUnit?: string };
    output: { id: string; methodId: string; minValue: number; maxValue: number | null; amountMinor: number; perUnitMinor: number; [key: string]: unknown };
  };
  "catalog.addWishlistItem": {
    input: { contactId: string; variantId: string };
    output: { wishlist: { id: string; contactId: string; name: string; createdAt: string; updatedAt: string; [key: string]: unknown } | null; items: { id: string; variantId: string; sku: string; productName: string; [key: string]: unknown }[] };
  };
  "catalog.adjustStock": {
    input: { itemId: string; delta: number; note: string };
    output: { movement: { id: string; inventoryItemId: string; delta: number; reason: "sale" | "return" | "adjustment" | "transfer" | "receipt" | "damage" | "count"; referenceType: string | null; referenceId: string | null; actor: string; note: string | null; createdAt: string; [key: string]: unknown } | null; balance: { onHand: number; reserved: number; incoming: number; available: number } };
  };
  "catalog.applyCouponToCart": {
    input: { cartId: string; code: string };
    output: { cartId: string; coupon: { id: string; code: string; kind: "percent" | "fixed" | "free_shipping"; percentOffPpm: number | null; amountMinor: number | null; currency: string | null; minSubtotalMinor: number; maxRedemptions: number | null; perContactLimit: number; startsAt: string | null; endsAt: string | null; active: boolean; recovery: boolean; createdAt: string; updatedAt: string; [key: string]: unknown } };
  };
  "catalog.applyGiftCardToInvoice": {
    input: { code: string; contactId: string; invoiceId: string; orderId?: string; amountMinor: number; idempotencyKey: string };
    output: { giftCardId: string; amountMinor: number; remainingMinor: number; payment: { id: string; invoiceId: string; provider: string; providerCheckoutRef: string | null; providerRef: string | null; idempotencyKey: string; requestHash: string; status: "created" | "processing" | "succeeded" | "failed" | "cancelled"; method: string; currency: string; amountMinor: number; refundedMinor: number; failureCode: string | null; failureMessage: string | null; processedAt: string | null; failedAt: string | null; metadata: unknown; createdAt: string; updatedAt: string; [key: string]: unknown } };
  };
  "catalog.applyVariantMatrix": {
    input: { productId: string; expectedVersion: number };
    output: { id: string; name: string; slug: string; kind: "physical" | "digital" | "service" | "rental" | "bundle" | "pass"; subtitle: string | null; description: unknown; brand: string | null; status: "draft" | "active" | "archived"; visibility: "public" | "unlisted" | "member_only"; taxCategoryId: string | null; seo: unknown; workingName: string | null; workingSubtitle: string | null; workingDescription: unknown | null; workingSeo: unknown | null; schemaType: string; publishedAt: string | null; archivedAt: string | null; version: number; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "catalog.archiveProduct": {
    input: { id: string; expectedVersion: number; reason: string };
    output: { id: string; name: string; slug: string; kind: "physical" | "digital" | "service" | "rental" | "bundle" | "pass"; subtitle: string | null; description: unknown; brand: string | null; status: "draft" | "active" | "archived"; visibility: "public" | "unlisted" | "member_only"; taxCategoryId: string | null; seo: unknown; workingName: string | null; workingSubtitle: string | null; workingDescription: unknown | null; workingSeo: unknown | null; schemaType: string; publishedAt: string | null; archivedAt: string | null; version: number; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "catalog.assignProductOption": {
    input: { productId: string; expectedVersion: number; optionTypeId: string };
    output: { id: string; name: string; slug: string; kind: "physical" | "digital" | "service" | "rental" | "bundle" | "pass"; subtitle: string | null; description: unknown; brand: string | null; status: "draft" | "active" | "archived"; visibility: "public" | "unlisted" | "member_only"; taxCategoryId: string | null; seo: unknown; workingName: string | null; workingSubtitle: string | null; workingDescription: unknown | null; workingSeo: unknown | null; schemaType: string; publishedAt: string | null; archivedAt: string | null; version: number; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "catalog.attachCartToContact": {
    input: { token: string; contactId: string };
    output: { cart: { id: string; token: string; contactId: string | null; currency: string; kind: "cart" | "saved"; status: "open" | "converted" | "abandoned"; name: string | null; lastActivityAt: string; abandonedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }; lines: { id: string; cartId: string; variantId: string; locationId: string | null; quantity: number; reservationId: string | null; galleryId: string | null; assetId: string | null; createdAt: string; updatedAt: string; sku: string; productName: string; requiresShipping: boolean; weightG: number | null; lengthMm: number | null; widthMm: number | null; heightMm: number | null; unitAmountMinor: number | null; lineTotalMinor: number | null; priceAvailable: boolean; priceReason: string | null; stock: { tracked: false; available: boolean; quantity?: number } | { tracked: true; available: boolean; backordered: boolean; restockAt: string | null; onHand: number; reserved: number; incoming: number; canPromise: number }; [key: string]: unknown }[]; subtotalMinor: number; allPriced: boolean; allAvailable: boolean };
  };
  "catalog.attachProductMedia": {
    input: { productId: string; expectedVersion: number; assetId: string; role?: "360" | "hero" | "gallery" | "swatch" | "size_chart" | "lifestyle" | "model"; variantId?: string; position?: number };
    output: { id: string; name: string; slug: string; kind: "physical" | "digital" | "service" | "rental" | "bundle" | "pass"; subtitle: string | null; description: unknown; brand: string | null; status: "draft" | "active" | "archived"; visibility: "public" | "unlisted" | "member_only"; taxCategoryId: string | null; seo: unknown; workingName: string | null; workingSubtitle: string | null; workingDescription: unknown | null; workingSeo: unknown | null; schemaType: string; publishedAt: string | null; archivedAt: string | null; version: number; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "catalog.availability": {
    input: { variantId: string; locationId?: string; quantity?: number };
    output: { tracked: false; available: true; quantity: number } | { tracked: true; available: boolean; backordered: boolean; restockAt: string | null; onHand: number; reserved: number; incoming: number; canPromise: number };
  };
  "catalog.bookingRequirements": {
    input: { serviceOfferingId: string };
    output: { intakeFormId: string | null; waiverTitle: string | null; waiverBody: string | null; reminderOffsetsMin: number[] } | null;
  };
  "catalog.bookingTerms": {
    input: { serviceOfferingId: string };
    output: { name: string; freeUntilHours: number; feeType: "none" | "fixed" | "percent" | "forfeit_deposit"; feeValue: number | null; rescheduleLimit: number; noShowFeeMinor: number } | null;
  };
  "catalog.cancelOrder": {
    input: { id: string };
    output: { order: { id: string; contactId: string; cartId: string | null; invoiceId: string | null; currency: string; status: "pending_payment" | "paid" | "fulfilling" | "fulfilled" | "refunded" | "cancelled"; subtotalMinor: number; discountMinor: number; shippingMinor: number; taxMinor: number; totalMinor: number; couponId: string | null; shippingMethodId: string | null; shippingAddress: unknown | null; createdAt: string; updatedAt: string; [key: string]: unknown }; lines: { id: string; orderId: string; variantId: string; quantity: number; unitAmountMinor: number; lineTotalMinor: number; snapshot: unknown; createdAt: string; [key: string]: unknown }[] };
  };
  "catalog.cancelPurchaseOrder": {
    input: { id: string };
    output: { id: string; supplierId: string; locationId: string; status: "draft" | "ordered" | "partial" | "received" | "cancelled"; currency: string; expectedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "catalog.checkoutCart": {
    input: { cartId: string; contactId: string; idempotencyKey: string; acceptedTerms: true; shippingAddress?: { name?: string; street1?: string; city?: string; region?: string; postalCode?: string; country: string }; shippingMethodId?: string; locationId?: string; couponCode?: string; giftCardCode?: string; applyBalance?: boolean };
    output: { order: { id: string; contactId: string; cartId: string | null; invoiceId: string | null; currency: string; status: "pending_payment" | "paid" | "fulfilling" | "fulfilled" | "refunded" | "cancelled"; subtotalMinor: number; discountMinor: number; shippingMinor: number; taxMinor: number; totalMinor: number; couponId: string | null; shippingMethodId: string | null; shippingAddress: unknown | null; createdAt: string; updatedAt: string; [key: string]: unknown }; lines: { id: string; orderId: string; variantId: string; quantity: number; unitAmountMinor: number; lineTotalMinor: number; snapshot: unknown; createdAt: string; [key: string]: unknown }[] };
  };
  "catalog.compareProducts": {
    input: { productIds: string[] };
    output: { products: { id: string; name: string; slug: string; kind: "physical" | "digital" | "service" | "rental" | "bundle" | "pass"; subtitle: string | null; description: unknown; brand: string | null; status: "draft" | "active" | "archived"; visibility: "public" | "unlisted" | "member_only"; taxCategoryId: string | null; seo: unknown; workingName: string | null; workingSubtitle: string | null; workingDescription: unknown | null; workingSeo: unknown | null; schemaType: string; publishedAt: string | null; archivedAt: string | null; version: number; createdAt: string; updatedAt: string; [key: string]: unknown }[]; rows: { key: string; label: string; kind: "text" | "number" | "bool" | "enum" | "measure"; unit: string | null; groupName: string | null; values: { [key: string]: boolean | string | null } }[] };
  };
  "catalog.consumeReservation": {
    input: { id: string; note?: string };
    output: { movement: { id: string; inventoryItemId: string; delta: number; reason: "sale" | "return" | "adjustment" | "transfer" | "receipt" | "damage" | "count"; referenceType: string | null; referenceId: string | null; actor: string; note: string | null; createdAt: string; [key: string]: unknown } | null; balance: { onHand: number; reserved: number; incoming: number; available: number } };
  };
  "catalog.countStock": {
    input: { itemId: string; quantity: number; note?: string };
    output: { movement: { id: string; inventoryItemId: string; delta: number; reason: "sale" | "return" | "adjustment" | "transfer" | "receipt" | "damage" | "count"; referenceType: string | null; referenceId: string | null; actor: string; note: string | null; createdAt: string; [key: string]: unknown } | null; balance: { onHand: number; reserved: number; incoming: number; available: number } };
  };
  "catalog.createAttributeDefinition": {
    input: { key: string; label: string; kind: "text" | "number" | "bool" | "enum" | "measure"; unit?: string; groupName?: string; isFilterable?: boolean; isComparable?: boolean; enumOptions?: string[] };
    output: { id: string; key: string; label: string; kind: "text" | "number" | "bool" | "enum" | "measure"; unit: string | null; groupName: string | null; isFilterable: boolean; isComparable: boolean; enumOptions: string[]; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "catalog.createCancellationPolicy": {
    input: { name: string; freeUntilHours?: number; feeType?: "none" | "fixed" | "percent" | "forfeit_deposit"; feeAmount?: string; feePercentPpm?: number; rescheduleLimit?: number; noShowFeeAmount?: string; currency?: string };
    output: { id: string; name: string; freeUntilHours: number; feeType: "none" | "fixed" | "percent" | "forfeit_deposit"; feeValue: number | null; rescheduleLimit: number; noShowFeeMinor: number; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "catalog.createCoupon": {
    input: { code: string; kind: "percent" | "fixed" | "free_shipping"; percentOffPpm?: number; amount?: string; currency?: string; minSubtotal?: string; maxRedemptions?: number; perContactLimit?: number; startsAt?: string; endsAt?: string; recovery?: boolean };
    output: { id: string; code: string; kind: "percent" | "fixed" | "free_shipping"; percentOffPpm: number | null; amountMinor: number | null; currency: string | null; minSubtotalMinor: number; maxRedemptions: number | null; perContactLimit: number; startsAt: string | null; endsAt: string | null; active: boolean; recovery: boolean; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "catalog.createCustomerGroup": {
    input: { name: string; tag?: string; lifecycleStage?: "lead" | "prospect" | "customer" | "repeat"; taxExempt?: boolean; exemptionRef?: string };
    output: { id: string; name: string; tag: string | null; lifecycleStage: string | null; taxExempt: boolean; exemptionRef: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "catalog.createDeliveryWindow": {
    input: { locationId: string; starts: string; ends: string; capacity?: number; cutoffHours?: number };
    output: { id: string; locationId: string; onDate: string | null; starts: string; ends: string; capacity: number; cutoffHours: number; createdAt: string; [key: string]: unknown };
  };
  "catalog.createFulfillment": {
    input: { orderId: string; locationId?: string; items: { orderItemId: string; quantity: number }[] };
    output: { fulfillment: { id: string; orderId: string; locationId: string | null; kind: "physical" | "digital"; status: "pending" | "picking" | "packed" | "shipped" | "delivered" | "failed" | "returned"; boxId: string | null; weightG: number | null; carrier: string | null; service: string | null; trackingNumber: string | null; trackingUrl: string | null; shippedAt: string | null; deliveredAt: string | null; note: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }; items: { id: string; fulfillmentId: string; orderItemId: string; quantity: number; createdAt: string; [key: string]: unknown }[] };
  };
  "catalog.createOfferRule": {
    input: { kind: "bump" | "post_add"; name: string; triggerVariantId?: string; offerVariantId: string };
    output: { id: string; kind: "bump" | "post_add"; name: string; triggerVariantId: string | null; offerVariantId: string; active: boolean; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "catalog.createOptionType": {
    input: { name: string; code: string };
    output: { id: string; name: string; code: string; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "catalog.createPackagingBox": {
    input: { name: string; innerLengthMm: number; innerWidthMm: number; innerHeightMm: number; maxWeightG: number; tareWeightG?: number };
    output: { id: string; name: string; innerLengthMm: number; innerWidthMm: number; innerHeightMm: number; maxWeightG: number; tareWeightG: number; createdAt: string; [key: string]: unknown };
  };
  "catalog.createPriceList": {
    input: { name: string; currency: string; kind?: "retail" | "wholesale" | "member" | "sale" | "contract"; customerGroupId?: string; segmentId?: string; contactId?: string; startsAt?: string; endsAt?: string; priority?: number; active?: boolean };
    output: { id: string; name: string; currency: string; kind: "retail" | "wholesale" | "member" | "sale" | "contract"; customerGroupId: string | null; segmentId: string | null; contactId: string | null; startsAt: string | null; endsAt: string | null; priority: number; active: boolean; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "catalog.createProduct": {
    input: { name: string; slug: string; kind: "physical" | "digital" | "service" | "rental" | "bundle" | "pass"; visibility?: "public" | "unlisted" | "member_only"; subtitle?: string | null; brand?: string | null; taxCategoryId?: string | null; description?: unknown; seo?: { title?: string; description?: string } };
    output: { id: string; name: string; slug: string; kind: "physical" | "digital" | "service" | "rental" | "bundle" | "pass"; subtitle: string | null; description: unknown; brand: string | null; status: "draft" | "active" | "archived"; visibility: "public" | "unlisted" | "member_only"; taxCategoryId: string | null; seo: unknown; workingName: string | null; workingSubtitle: string | null; workingDescription: unknown | null; workingSeo: unknown | null; schemaType: string; publishedAt: string | null; archivedAt: string | null; version: number; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "catalog.createPurchaseOrder": {
    input: { supplierId: string; locationId: string; expectedAt?: string };
    output: { id: string; supplierId: string; locationId: string; status: "draft" | "ordered" | "partial" | "received" | "cancelled"; currency: string; expectedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "catalog.createShippingMethod": {
    input: { zoneId: string; name: string; kind: "flat" | "weight" | "price" | "item" | "dimensional" | "free" | "pickup" | "local_delivery"; currency: string; handlingFee?: string; amount?: string; threshold?: string; minDays?: number; maxDays?: number; locationId?: string };
    output: { id: string; zoneId: string; name: string; kind: "flat" | "weight" | "price" | "item" | "dimensional" | "free" | "pickup" | "local_delivery"; handlingFeeMinor: number; amountMinor: number | null; thresholdMinor: number | null; minDays: number | null; maxDays: number | null; taxable: boolean; locationId: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "catalog.createShippingZone": {
    input: { name: string; countries?: string[]; regions?: string[]; postalPatterns?: string[]; priority?: number };
    output: { id: string; name: string; countries: string[]; regions: string[]; postalPatterns: string[]; priority: number; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "catalog.createSupplier": {
    input: { name: string; currency: string; leadTimeDays?: number; contactId?: string };
    output: { id: string; name: string; contactId: string | null; leadTimeDays: number; currency: string; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "catalog.decideReturn": {
    input: { id: string; decision: "approved" | "rejected"; labelUrl?: string };
    output: { return: { id: string; orderId: string; contactId: string; status: "requested" | "approved" | "received" | "refunded" | "rejected"; reason: string; restock: boolean; labelUrl: string | null; creditNoteId: string | null; refundId: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }; items: { id: string; returnId: string; orderItemId: string; quantity: number; restockedQuantity: number; createdAt: string; [key: string]: unknown }[] };
  };
  "catalog.deleteCancellationPolicy": {
    input: { id: string };
    output: { id: string };
  };
  "catalog.deliverFulfillment": {
    input: { id: string };
    output: { fulfillment: { id: string; orderId: string; locationId: string | null; kind: "physical" | "digital"; status: "pending" | "picking" | "packed" | "shipped" | "delivered" | "failed" | "returned"; boxId: string | null; weightG: number | null; carrier: string | null; service: string | null; trackingNumber: string | null; trackingUrl: string | null; shippedAt: string | null; deliveredAt: string | null; note: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }; items: { id: string; fulfillmentId: string; orderItemId: string; quantity: number; createdAt: string; [key: string]: unknown }[] };
  };
  "catalog.detachProductMedia": {
    input: { productId: string; expectedVersion: number; mediaId: string };
    output: { id: string; name: string; slug: string; kind: "physical" | "digital" | "service" | "rental" | "bundle" | "pass"; subtitle: string | null; description: unknown; brand: string | null; status: "draft" | "active" | "archived"; visibility: "public" | "unlisted" | "member_only"; taxCategoryId: string | null; seo: unknown; workingName: string | null; workingSubtitle: string | null; workingDescription: unknown | null; workingSeo: unknown | null; schemaType: string; publishedAt: string | null; archivedAt: string | null; version: number; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "catalog.enableInventory": {
    input: { variantId: string; locationId: string; bin?: string };
    output: { id: string; variantId: string; locationId: string; bin: string | null; safetyStock: number; reorderPoint: number; incoming: number; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "catalog.expireReservations": {
    input: Record<string, never>;
    output: { expired: number };
  };
  "catalog.failFulfillment": {
    input: { id: string; note: string };
    output: { fulfillment: { id: string; orderId: string; locationId: string | null; kind: "physical" | "digital"; status: "pending" | "picking" | "packed" | "shipped" | "delivered" | "failed" | "returned"; boxId: string | null; weightG: number | null; carrier: string | null; service: string | null; trackingNumber: string | null; trackingUrl: string | null; shippedAt: string | null; deliveredAt: string | null; note: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }; items: { id: string; fulfillmentId: string; orderItemId: string; quantity: number; createdAt: string; [key: string]: unknown }[] };
  };
  "catalog.filterProductsByAttribute": {
    input: { key: string; equals?: string; min?: string; max?: string; bool?: boolean };
    output: { id: string; name: string; slug: string; kind: "physical" | "digital" | "service" | "rental" | "bundle" | "pass"; subtitle: string | null; description: unknown; brand: string | null; status: "draft" | "active" | "archived"; visibility: "public" | "unlisted" | "member_only"; taxCategoryId: string | null; seo: unknown; workingName: string | null; workingSubtitle: string | null; workingDescription: unknown | null; workingSeo: unknown | null; schemaType: string; publishedAt: string | null; archivedAt: string | null; version: number; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "catalog.getCart": {
    input: { cartId?: string; token?: string };
    output: { cart: { id: string; token: string; contactId: string | null; currency: string; kind: "cart" | "saved"; status: "open" | "converted" | "abandoned"; name: string | null; lastActivityAt: string; abandonedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }; lines: { id: string; cartId: string; variantId: string; locationId: string | null; quantity: number; reservationId: string | null; galleryId: string | null; assetId: string | null; createdAt: string; updatedAt: string; sku: string; productName: string; requiresShipping: boolean; weightG: number | null; lengthMm: number | null; widthMm: number | null; heightMm: number | null; unitAmountMinor: number | null; lineTotalMinor: number | null; priceAvailable: boolean; priceReason: string | null; stock: { tracked: false; available: boolean; quantity?: number } | { tracked: true; available: boolean; backordered: boolean; restockAt: string | null; onHand: number; reserved: number; incoming: number; canPromise: number }; [key: string]: unknown }[]; subtotalMinor: number; allPriced: boolean; allAvailable: boolean };
  };
  "catalog.getFulfillment": {
    input: { id: string };
    output: { fulfillment: { id: string; orderId: string; locationId: string | null; kind: "physical" | "digital"; status: "pending" | "picking" | "packed" | "shipped" | "delivered" | "failed" | "returned"; boxId: string | null; weightG: number | null; carrier: string | null; service: string | null; trackingNumber: string | null; trackingUrl: string | null; shippedAt: string | null; deliveredAt: string | null; note: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }; items: { id: string; fulfillmentId: string; orderItemId: string; quantity: number; createdAt: string; [key: string]: unknown }[] };
  };
  "catalog.getOrCreateCart": {
    input: { token?: string; contactId?: string; currency: string };
    output: { cart: { id: string; token: string; contactId: string | null; currency: string; kind: "cart" | "saved"; status: "open" | "converted" | "abandoned"; name: string | null; lastActivityAt: string; abandonedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }; lines: { id: string; cartId: string; variantId: string; locationId: string | null; quantity: number; reservationId: string | null; galleryId: string | null; assetId: string | null; createdAt: string; updatedAt: string; sku: string; productName: string; requiresShipping: boolean; weightG: number | null; lengthMm: number | null; widthMm: number | null; heightMm: number | null; unitAmountMinor: number | null; lineTotalMinor: number | null; priceAvailable: boolean; priceReason: string | null; stock: { tracked: false; available: boolean; quantity?: number } | { tracked: true; available: boolean; backordered: boolean; restockAt: string | null; onHand: number; reserved: number; incoming: number; canPromise: number }; [key: string]: unknown }[]; subtotalMinor: number; allPriced: boolean; allAvailable: boolean };
  };
  "catalog.getOrder": {
    input: { id: string };
    output: { order: { id: string; contactId: string; cartId: string | null; invoiceId: string | null; currency: string; status: "pending_payment" | "paid" | "fulfilling" | "fulfilled" | "refunded" | "cancelled"; subtotalMinor: number; discountMinor: number; shippingMinor: number; taxMinor: number; totalMinor: number; couponId: string | null; shippingMethodId: string | null; shippingAddress: unknown | null; createdAt: string; updatedAt: string; [key: string]: unknown }; lines: { id: string; orderId: string; variantId: string; quantity: number; unitAmountMinor: number; lineTotalMinor: number; snapshot: unknown; createdAt: string; [key: string]: unknown }[] };
  };
  "catalog.getProduct": {
    input: { id: string };
    output: { product: { id: string; name: string; slug: string; kind: "physical" | "digital" | "service" | "rental" | "bundle" | "pass"; subtitle: string | null; description: unknown; brand: string | null; status: "draft" | "active" | "archived"; visibility: "public" | "unlisted" | "member_only"; taxCategoryId: string | null; seo: unknown; workingName: string | null; workingSubtitle: string | null; workingDescription: unknown | null; workingSeo: unknown | null; schemaType: string; publishedAt: string | null; archivedAt: string | null; version: number; createdAt: string; updatedAt: string; [key: string]: unknown }; history: { id: string; productId: string; fromStatus: ("draft" | "active" | "archived") | null; toStatus: "draft" | "active" | "archived"; fromVisibility: ("public" | "unlisted" | "member_only") | null; toVisibility: "public" | "unlisted" | "member_only"; resultingVersion: number; actor: string; reason: string | null; createdAt: string; [key: string]: unknown }[] };
  };
  "catalog.getProductVariants": {
    input: { productId: string };
    output: { product: { id: string; name: string; slug: string; kind: "physical" | "digital" | "service" | "rental" | "bundle" | "pass"; subtitle: string | null; description: unknown; brand: string | null; status: "draft" | "active" | "archived"; visibility: "public" | "unlisted" | "member_only"; taxCategoryId: string | null; seo: unknown; workingName: string | null; workingSubtitle: string | null; workingDescription: unknown | null; workingSeo: unknown | null; schemaType: string; publishedAt: string | null; archivedAt: string | null; version: number; createdAt: string; updatedAt: string; [key: string]: unknown }; assignments: { id: string; productId: string; optionTypeId: string; position: number; createdAt: string; optionType: { id: string; name: string; code: string; createdAt: string; updatedAt: string; [key: string]: unknown } | null; selectedValueIds: string[]; values: { id: string; optionTypeId: string; name: string; skuFragment: string; position: number; createdAt: string; updatedAt: string; [key: string]: unknown }[]; [key: string]: unknown }[]; variants: { id: string; productId: string; combinationKey: string; sku: string; isDefault: boolean; status: "active" | "archived"; backorderPolicy: "refuse" | "allow_date" | "allow_silent"; expectedRestockAt: string | null; requiresShipping: boolean; weightG: number | null; lengthMm: number | null; widthMm: number | null; heightMm: number | null; createdAt: string; updatedAt: string; options: { variantId: string; optionTypeId: string; optionValueId: string; [key: string]: unknown }[]; [key: string]: unknown }[]; preview: { add: { valueIds: string[]; fragments: string[]; labels: string[] }[]; retain: { id: string; productId: string; combinationKey: string; sku: string; isDefault: boolean; status: "active" | "archived"; backorderPolicy: "refuse" | "allow_date" | "allow_silent"; expectedRestockAt: string | null; requiresShipping: boolean; weightG: number | null; lengthMm: number | null; widthMm: number | null; heightMm: number | null; createdAt: string; updatedAt: string; [key: string]: unknown }[]; archive: { id: string; productId: string; combinationKey: string; sku: string; isDefault: boolean; status: "active" | "archived"; backorderPolicy: "refuse" | "allow_date" | "allow_silent"; expectedRestockAt: string | null; requiresShipping: boolean; weightG: number | null; lengthMm: number | null; widthMm: number | null; heightMm: number | null; createdAt: string; updatedAt: string; [key: string]: unknown }[]; reactivate: { id: string; productId: string; combinationKey: string; sku: string; isDefault: boolean; status: "active" | "archived"; backorderPolicy: "refuse" | "allow_date" | "allow_silent"; expectedRestockAt: string | null; requiresShipping: boolean; weightG: number | null; lengthMm: number | null; widthMm: number | null; heightMm: number | null; createdAt: string; updatedAt: string; [key: string]: unknown }[] } };
  };
  "catalog.getReturn": {
    input: { id: string };
    output: { return: { id: string; orderId: string; contactId: string; status: "requested" | "approved" | "received" | "refunded" | "rejected"; reason: string; restock: boolean; labelUrl: string | null; creditNoteId: string | null; refundId: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }; items: { id: string; returnId: string; orderItemId: string; quantity: number; restockedQuantity: number; createdAt: string; [key: string]: unknown }[] };
  };
  "catalog.getServiceOffering": {
    input: { productId: string };
    output: { id: string; productId: string; durationMin: number; bufferBeforeMin: number; bufferAfterMin: number; locationType: "in_person" | "virtual" | "client_site"; depositType: "none" | "fixed" | "percent"; depositValue: number; cancellationPolicyId: string | null; intakeFormId: string | null; waiverTemplateId: string | null; waiverTitle: string | null; waiverBody: string | null; reminderOffsetsMin: number[]; capacity: number; assignment: "specific" | "pool" | "round_robin"; calendarIds: string[]; travelTimeMin: number; createdAt: string; updatedAt: string; [key: string]: unknown } | null;
  };
  "catalog.giftCardByShareToken": {
    input: { token: string };
    output: { remainingMinor: number; issuedMinor: number; currency: string; code: string; expiresAt: string | null; status: "active" | "redeemed" | "void" } | null;
  };
  "catalog.grantDigitalFulfillment": {
    input: { orderId: string };
    output: { grants: { id: string; orderId: string; orderItemId: string; token: string; assetId: string | null; grantedAt: string; downloadedAt: string | null; createdAt: string; [key: string]: unknown }[] };
  };
  "catalog.issueGiftCard": {
    input: { code: string; currency: string; amount: string; contactId?: string; expiresAt?: string; note?: string };
    output: { id: string; code: string; currency: string; issuedMinor: number; remainingMinor: number; contactId: string | null; status: "active" | "redeemed" | "void"; expiresAt: string | null; note: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "catalog.listAttributeDefinitions": {
    input: Record<string, never>;
    output: { id: string; key: string; label: string; kind: "text" | "number" | "bool" | "enum" | "measure"; unit: string | null; groupName: string | null; isFilterable: boolean; isComparable: boolean; enumOptions: string[]; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "catalog.listBundleComponents": {
    input: { productId: string };
    output: { id: string; bundleProductId: string; componentVariantId: string; quantity: number; priceMode: "sum" | "fixed" | "percent_off"; amountMinor: number | null; percentOffPpm: number | null; position: number; createdAt: string; [key: string]: unknown }[];
  };
  "catalog.listCancellationPolicies": {
    input: Record<string, never>;
    output: { id: string; name: string; freeUntilHours: number; feeType: "none" | "fixed" | "percent" | "forfeit_deposit"; feeValue: number | null; rescheduleLimit: number; noShowFeeMinor: number; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "catalog.listCartOffers": {
    input: { cartId: string; justAddedVariantId?: string };
    output: { rule: { id: string; kind: "bump" | "post_add"; name: string; triggerVariantId: string | null; offerVariantId: string; active: boolean; createdAt: string; updatedAt: string; [key: string]: unknown }; variant: { id: string; sku: string; productName: string; [key: string]: unknown } }[];
  };
  "catalog.listCarts": {
    input: { status?: "open" | "converted" | "abandoned" };
    output: { id: string; token: string; contactId: string | null; currency: string; kind: "cart" | "saved"; status: "open" | "converted" | "abandoned"; name: string | null; lastActivityAt: string; abandonedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "catalog.listCoupons": {
    input: Record<string, never>;
    output: { id: string; code: string; kind: "percent" | "fixed" | "free_shipping"; percentOffPpm: number | null; amountMinor: number | null; currency: string | null; minSubtotalMinor: number; maxRedemptions: number | null; perContactLimit: number; startsAt: string | null; endsAt: string | null; active: boolean; recovery: boolean; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "catalog.listCustomerGroups": {
    input: Record<string, never>;
    output: { id: string; name: string; tag: string | null; lifecycleStage: string | null; taxExempt: boolean; exemptionRef: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "catalog.listDigitalDeliveries": {
    input: { orderId: string };
    output: { id: string; orderId: string; orderItemId: string; token: string; assetId: string | null; grantedAt: string; downloadedAt: string | null; createdAt: string; [key: string]: unknown }[];
  };
  "catalog.listFulfillmentQueue": {
    input: Record<string, never>;
    output: { id: string; contactId: string; cartId: string | null; invoiceId: string | null; currency: string; status: "pending_payment" | "paid" | "fulfilling" | "fulfilled" | "refunded" | "cancelled"; subtotalMinor: number; discountMinor: number; shippingMinor: number; taxMinor: number; totalMinor: number; couponId: string | null; shippingMethodId: string | null; shippingAddress: unknown | null; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "catalog.listFulfillments": {
    input: { orderId?: string; status?: "pending" | "picking" | "packed" | "shipped" | "delivered" | "failed" | "returned" };
    output: { id: string; orderId: string; locationId: string | null; kind: "physical" | "digital"; status: "pending" | "picking" | "packed" | "shipped" | "delivered" | "failed" | "returned"; boxId: string | null; weightG: number | null; carrier: string | null; service: string | null; trackingNumber: string | null; trackingUrl: string | null; shippedAt: string | null; deliveredAt: string | null; note: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "catalog.listGiftCards": {
    input: Record<string, never>;
    output: { id: string; code: string; currency: string; issuedMinor: number; remainingMinor: number; contactId: string | null; status: "active" | "redeemed" | "void"; expiresAt: string | null; note: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "catalog.listInventory": {
    input: { locationId?: string; variantId?: string };
    output: { id: string; variantId: string; locationId: string; bin: string | null; safetyStock: number; reorderPoint: number; incoming: number; createdAt: string; updatedAt: string; sku: string; productName: string; locationName: string; isPrimary: boolean; onHand: number; reserved: number; available: number; [key: string]: unknown }[];
  };
  "catalog.listOfferRules": {
    input: Record<string, never>;
    output: { id: string; kind: "bump" | "post_add"; name: string; triggerVariantId: string | null; offerVariantId: string; active: boolean; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "catalog.listOptionTypes": {
    input: Record<string, never>;
    output: { id: string; name: string; code: string; createdAt: string; updatedAt: string; values: { id: string; optionTypeId: string; name: string; skuFragment: string; position: number; createdAt: string; updatedAt: string; [key: string]: unknown }[]; [key: string]: unknown }[];
  };
  "catalog.listOrders": {
    input: { contactId?: string };
    output: { id: string; contactId: string; cartId: string | null; invoiceId: string | null; currency: string; status: "pending_payment" | "paid" | "fulfilling" | "fulfilled" | "refunded" | "cancelled"; subtotalMinor: number; discountMinor: number; shippingMinor: number; taxMinor: number; totalMinor: number; couponId: string | null; shippingMethodId: string | null; shippingAddress: unknown | null; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "catalog.listPriceLists": {
    input: { currency?: string; kind?: "retail" | "wholesale" | "member" | "sale" | "contract" };
    output: { id: string; name: string; currency: string; kind: "retail" | "wholesale" | "member" | "sale" | "contract"; customerGroupId: string | null; segmentId: string | null; contactId: string | null; startsAt: string | null; endsAt: string | null; priority: number; active: boolean; createdAt: string; updatedAt: string; entries: { id: string; priceListId: string; variantId: string; amountMinor: number; compareAtMinor: number | null; createdAt: string; updatedAt: string; [key: string]: unknown }[]; [key: string]: unknown }[];
  };
  "catalog.listPriceRules": {
    input: { productId: string };
    output: { id: string; productId: string; mode: "full" | "deposit_balance" | "payment_plan" | "hourly" | "retainer"; planSchedule: unknown; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "catalog.listProductAttributes": {
    input: { productId: string };
    output: { productId: string; attributeId: string; textValue: string | null; numberValue: string | null; boolValue: boolean | null; key: string; label: string; kind: "text" | "number" | "bool" | "enum" | "measure"; unit: string | null; groupName: string | null; isFilterable: boolean; isComparable: boolean; [key: string]: unknown }[];
  };
  "catalog.listProductMedia": {
    input: { productId: string; variantId?: string };
    output: { media: { id: string; productId: string; variantId: string | null; assetId: string; role: "360" | "hero" | "gallery" | "swatch" | "size_chart" | "lifestyle" | "model"; position: number; createdAt: string; [key: string]: unknown }; asset: { id: string; kind: "image" | "video" | "doc" | "audio"; storageKey: string; filename: string; mime: string; legacyBytes: number; bytes: number; width: number | null; height: number | null; durationSeconds: number | null; variants: unknown; altText: string | null; blurhash: string | null; status: string; scanStatus: string; scanEngine: string | null; scanMessage: string | null; scannedAt: string | null; checksumSha256: string | null; metadata: unknown; provenance: unknown; source: string; uploadedBy: string | null; focalX: number; focalY: number; deletedAt: string | null; purgeAfter: string | null; createdAt: string; updatedAt: string; [key: string]: unknown } }[];
  };
  "catalog.listProductRelations": {
    input: { productId: string };
    output: { id: string; kind: "upsell" | "cross_sell" | "accessory" | "replacement" | "variant_of"; position: number; related: { id: string; name: string; slug: string; kind: "physical" | "digital" | "service" | "rental" | "bundle" | "pass"; subtitle: string | null; description: unknown; brand: string | null; status: "draft" | "active" | "archived"; visibility: "public" | "unlisted" | "member_only"; taxCategoryId: string | null; seo: unknown; workingName: string | null; workingSubtitle: string | null; workingDescription: unknown | null; workingSeo: unknown | null; schemaType: string; publishedAt: string | null; archivedAt: string | null; version: number; createdAt: string; updatedAt: string; [key: string]: unknown }; [key: string]: unknown }[];
  };
  "catalog.listProducts": {
    input: { status?: "draft" | "active" | "archived"; kind?: "physical" | "digital" | "service" | "rental" | "bundle" | "pass"; visibility?: "public" | "unlisted" | "member_only"; limit?: number };
    output: { id: string; name: string; slug: string; kind: "physical" | "digital" | "service" | "rental" | "bundle" | "pass"; subtitle: string | null; description: unknown; brand: string | null; status: "draft" | "active" | "archived"; visibility: "public" | "unlisted" | "member_only"; taxCategoryId: string | null; seo: unknown; workingName: string | null; workingSubtitle: string | null; workingDescription: unknown | null; workingSeo: unknown | null; schemaType: string; publishedAt: string | null; archivedAt: string | null; version: number; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "catalog.listPurchaseOrders": {
    input: { status?: "draft" | "ordered" | "partial" | "received" | "cancelled" };
    output: { id: string; supplierId: string; locationId: string; status: "draft" | "ordered" | "partial" | "received" | "cancelled"; currency: string; expectedAt: string | null; createdAt: string; updatedAt: string; lines: { id: string; purchaseOrderId: string; variantId: string; quantity: number; receivedQty: number; unitCostMinor: number; createdAt: string; updatedAt: string; [key: string]: unknown }[]; [key: string]: unknown }[];
  };
  "catalog.listReorderQueue": {
    input: Record<string, never>;
    output: { id: string; variantId: string; locationId: string; bin: string | null; safetyStock: number; reorderPoint: number; incoming: number; createdAt: string; updatedAt: string; sku: string; productName: string; locationName: string; isPrimary: boolean; onHand: number; reserved: number; available: number; [key: string]: unknown }[];
  };
  "catalog.listReservations": {
    input: { itemId: string };
    output: { id: string; inventoryItemId: string; quantity: number; holderType: "cart" | "order" | "booking"; holderId: string; expiresAt: string; status: "active" | "consumed" | "released" | "expired"; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "catalog.listReturns": {
    input: { orderId?: string; status?: "requested" | "approved" | "received" | "refunded" | "rejected" };
    output: { id: string; orderId: string; contactId: string; status: "requested" | "approved" | "received" | "refunded" | "rejected"; reason: string; restock: boolean; labelUrl: string | null; creditNoteId: string | null; refundId: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "catalog.listSavedCarts": {
    input: { contactId: string };
    output: { cart: { id: string; token: string; contactId: string | null; currency: string; kind: "cart" | "saved"; status: "open" | "converted" | "abandoned"; name: string | null; lastActivityAt: string; abandonedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }; lines: { id: string; cartId: string; variantId: string; locationId: string | null; quantity: number; reservationId: string | null; galleryId: string | null; assetId: string | null; createdAt: string; updatedAt: string; sku: string; productName: string; requiresShipping: boolean; weightG: number | null; lengthMm: number | null; widthMm: number | null; heightMm: number | null; unitAmountMinor: number | null; lineTotalMinor: number | null; priceAvailable: boolean; priceReason: string | null; stock: { tracked: false; available: boolean; quantity?: number } | { tracked: true; available: boolean; backordered: boolean; restockAt: string | null; onHand: number; reserved: number; incoming: number; canPromise: number }; [key: string]: unknown }[]; subtotalMinor: number; allPriced: boolean; allAvailable: boolean }[];
  };
  "catalog.listSellableVariants": {
    input: Record<string, never>;
    output: { id: string; sku: string; productName: string; requiresShipping: boolean; [key: string]: unknown }[];
  };
  "catalog.listShippingCatalog": {
    input: Record<string, never>;
    output: { zones: { id: string; name: string; countries: string[]; regions: string[]; postalPatterns: string[]; priority: number; createdAt: string; updatedAt: string; [key: string]: unknown }[]; methods: { id: string; zoneId: string; name: string; kind: "flat" | "weight" | "price" | "item" | "dimensional" | "free" | "pickup" | "local_delivery"; handlingFeeMinor: number; amountMinor: number | null; thresholdMinor: number | null; minDays: number | null; maxDays: number | null; taxable: boolean; locationId: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[]; bands: { id: string; methodId: string; minValue: number; maxValue: number | null; amountMinor: number; perUnitMinor: number; [key: string]: unknown }[]; boxes: { id: string; name: string; innerLengthMm: number; innerWidthMm: number; innerHeightMm: number; maxWeightG: number; tareWeightG: number; createdAt: string; [key: string]: unknown }[]; windows: { id: string; locationId: string; onDate: string | null; starts: string; ends: string; capacity: number; cutoffHours: number; createdAt: string; [key: string]: unknown }[] };
  };
  "catalog.listShippingZones": {
    input: Record<string, never>;
    output: { id: string; name: string; countries: string[]; regions: string[]; postalPatterns: string[]; priority: number; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "catalog.listStockMovements": {
    input: { itemId: string; limit?: number };
    output: { id: string; inventoryItemId: string; delta: number; reason: "sale" | "return" | "adjustment" | "transfer" | "receipt" | "damage" | "count"; referenceType: string | null; referenceId: string | null; actor: string; note: string | null; createdAt: string; [key: string]: unknown }[];
  };
  "catalog.listSuppliers": {
    input: Record<string, never>;
    output: { id: string; name: string; contactId: string | null; leadTimeDays: number; currency: string; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "catalog.listTaxCategories": {
    input: Record<string, never>;
    output: { id: string; code: string; name: string; description: string | null; defaultRateHintPpm: number | null; active: boolean; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "catalog.listTrackedVariantChoices": {
    input: Record<string, never>;
    output: { id: string; sku: string; productName: string; [key: string]: unknown }[];
  };
  "catalog.listVisibleProducts": {
    input: { limit?: number };
    output: { id: string; name: string; slug: string; kind: "physical" | "digital" | "service" | "rental" | "bundle" | "pass"; subtitle: string | null; description: unknown; brand: string | null; visibility: "public" | "unlisted" | "member_only"; taxCategoryId: string | null; seo: unknown; schemaType: string; publishedAt: string | null; updatedAt: string; [key: string]: unknown }[];
  };
  "catalog.listWishlist": {
    input: { contactId?: string };
    output: { wishlist: { id: string; contactId: string; name: string; createdAt: string; updatedAt: string; [key: string]: unknown } | null; items: { id: string; variantId: string; sku: string; productName: string; [key: string]: unknown }[] };
  };
  "catalog.loadDemoFixture": {
    input: { scenarioKey: string; scenarioVersion: number; runId: string; generation: number; locale: string; records?: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
    output: { records: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
  };
  "catalog.packFulfillment": {
    input: { id: string; boxId?: string; weightG?: number };
    output: { fulfillment: { id: string; orderId: string; locationId: string | null; kind: "physical" | "digital"; status: "pending" | "picking" | "packed" | "shipped" | "delivered" | "failed" | "returned"; boxId: string | null; weightG: number | null; carrier: string | null; service: string | null; trackingNumber: string | null; trackingUrl: string | null; shippedAt: string | null; deliveredAt: string | null; note: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }; items: { id: string; fulfillmentId: string; orderItemId: string; quantity: number; createdAt: string; [key: string]: unknown }[] };
  };
  "catalog.payOrder": {
    input: { id: string };
    output: { order: { id: string; contactId: string; cartId: string | null; invoiceId: string | null; currency: string; status: "pending_payment" | "paid" | "fulfilling" | "fulfilled" | "refunded" | "cancelled"; subtotalMinor: number; discountMinor: number; shippingMinor: number; taxMinor: number; totalMinor: number; couponId: string | null; shippingMethodId: string | null; shippingAddress: unknown | null; createdAt: string; updatedAt: string; [key: string]: unknown }; lines: { id: string; orderId: string; variantId: string; quantity: number; unitAmountMinor: number; lineTotalMinor: number; snapshot: unknown; createdAt: string; [key: string]: unknown }[] };
  };
  "catalog.placePurchaseOrder": {
    input: { id: string };
    output: { id: string; supplierId: string; locationId: string; status: "draft" | "ordered" | "partial" | "received" | "cancelled"; currency: string; expectedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "catalog.publishProduct": {
    input: { id: string; expectedVersion: number };
    output: { id: string; name: string; slug: string; kind: "physical" | "digital" | "service" | "rental" | "bundle" | "pass"; subtitle: string | null; description: unknown; brand: string | null; status: "draft" | "active" | "archived"; visibility: "public" | "unlisted" | "member_only"; taxCategoryId: string | null; seo: unknown; workingName: string | null; workingSubtitle: string | null; workingDescription: unknown | null; workingSeo: unknown | null; schemaType: string; publishedAt: string | null; archivedAt: string | null; version: number; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "catalog.purgeDemoFixture": {
    input: { scenarioKey: string; scenarioVersion: number; runId: string; generation: number; locale: string; records?: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
    output: { purged: { subjectType: string; subjectId: string }[] };
  };
  "catalog.quoteBundle": {
    input: { productId: string; currency: string; contactId?: string; quantity?: number; at?: string };
    output: { available: boolean; currency: string; productId: string; totalMinor: number; reason: string; lines: { componentId: string; variantId: string; quantity: number; priceMode: "sum" | "fixed" | "percent_off"; amountMinor: number; explanation: string }[] };
  };
  "catalog.quoteCartPromotions": {
    input: { cartId: string; couponCode?: string; subtotalMinor: number; shippingMinor: number; currency: string };
    output: { discountMinor: number; shippingMinor: number; freeShipping: boolean; couponId: string | null; coupons: { id: string; code: string; kind: "percent" | "fixed" | "free_shipping"; percentOffPpm: number | null; amountMinor: number | null; currency: string | null; minSubtotalMinor: number; maxRedemptions: number | null; perContactLimit: number; startsAt: string | null; endsAt: string | null; active: boolean; recovery: boolean; createdAt: string; updatedAt: string; [key: string]: unknown }[] };
  };
  "catalog.quoteServicePayment": {
    input: { productId: string; currency: string; mode?: "full" | "deposit_balance" | "payment_plan" | "hourly" | "retainer"; contactId?: string; quantity?: number; at?: string };
    output: { available: false; mode: "full" | "deposit_balance" | "payment_plan" | "hourly" | "retainer"; currency: string; reason: string } | { available: true; mode: "full" | "deposit_balance" | "payment_plan" | "hourly" | "retainer"; currency: string; priceMinor: number; depositMinor: number; balanceMinor: number; dueNowMinor: number; schedule: unknown; durationMin: number; capacity: number; price: { available: false; currency: string; variantId: string; quantity: number; reason: string } | { available: true; currency: string; variantId: string; quantity: number; amountMinor: number; totalMinor: number; compareAtMinor: number | null; priceListId: string; priceListName: string; kind: "retail" | "wholesale" | "member" | "sale" | "contract"; breakMode: ("volume" | "tiered") | null; breakdown: { qty: number; unitMinor: number }[]; reason: string } };
  };
  "catalog.quoteShipping": {
    input: { country: string; region?: string; postal?: string; currency: string; locationId?: string; items: { quantity: number; weightG: number; priceMinor: number; lengthMm?: number; widthMm?: number; heightMm?: number; requiresShipping?: boolean }[] };
    output: { needed: boolean; zoneId: string | null; quotes: { methodId: string; name: string; kind: "flat" | "weight" | "price" | "item" | "dimensional" | "free" | "pickup" | "local_delivery"; amountMinor: number; currency: string; minDays: number | null; maxDays: number | null; billableWeightG: number; boxId: string | null; [key: string]: unknown }[] };
  };
  "catalog.receivePurchaseOrderLine": {
    input: { lineId: string; quantity: number; note?: string };
    output: { line: { id: string; purchaseOrderId: string; variantId: string; quantity: number; receivedQty: number; unitCostMinor: number; createdAt: string; updatedAt: string; [key: string]: unknown }; status: "draft" | "ordered" | "partial" | "received" | "cancelled" };
  };
  "catalog.receiveReturn": {
    input: { id: string; locationId?: string };
    output: { return: { id: string; orderId: string; contactId: string; status: "requested" | "approved" | "received" | "refunded" | "rejected"; reason: string; restock: boolean; labelUrl: string | null; creditNoteId: string | null; refundId: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }; items: { id: string; returnId: string; orderItemId: string; quantity: number; restockedQuantity: number; createdAt: string; [key: string]: unknown }[] };
  };
  "catalog.recordCouponRedemption": {
    input: { couponId: string; contactId: string; orderId: string; cartId?: string; discountMinor: number };
    output: { id: string; couponId: string; contactId: string; orderId: string | null; cartId: string | null; discountMinor: number; createdAt: string; [key: string]: unknown };
  };
  "catalog.recordDamage": {
    input: { itemId: string; quantity: number; note: string };
    output: { movement: { id: string; inventoryItemId: string; delta: number; reason: "sale" | "return" | "adjustment" | "transfer" | "receipt" | "damage" | "count"; referenceType: string | null; referenceId: string | null; actor: string; note: string | null; createdAt: string; [key: string]: unknown } | null; balance: { onHand: number; reserved: number; incoming: number; available: number } };
  };
  "catalog.recordStockMovement": {
    input: { itemId: string; delta: number; reason: "sale" | "return" | "adjustment" | "transfer" | "receipt" | "damage" | "count"; note?: string; referenceType?: string; referenceId?: string };
    output: { movement: { id: string; inventoryItemId: string; delta: number; reason: "sale" | "return" | "adjustment" | "transfer" | "receipt" | "damage" | "count"; referenceType: string | null; referenceId: string | null; actor: string; note: string | null; createdAt: string; [key: string]: unknown } | null; balance: { onHand: number; reserved: number; incoming: number; available: number } };
  };
  "catalog.recoverAbandonedCarts": {
    input: Record<string, never>;
    output: { sent: number };
  };
  "catalog.refundReturn": {
    input: { id: string; idempotencyKey: string };
    output: { return: { id: string; orderId: string; contactId: string; status: "requested" | "approved" | "received" | "refunded" | "rejected"; reason: string; restock: boolean; labelUrl: string | null; creditNoteId: string | null; refundId: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }; items: { id: string; returnId: string; orderItemId: string; quantity: number; restockedQuantity: number; createdAt: string; [key: string]: unknown }[] };
  };
  "catalog.releaseReservation": {
    input: { id: string };
    output: { reservation: { id: string; inventoryItemId: string; quantity: number; holderType: "cart" | "order" | "booking"; holderId: string; expiresAt: string; status: "active" | "consumed" | "released" | "expired"; createdAt: string; updatedAt: string; [key: string]: unknown }; balance: { onHand: number; reserved: number; incoming: number; available: number } };
  };
  "catalog.removeBundleComponent": {
    input: { productId: string; expectedVersion: number; componentId: string };
    output: { id: string; name: string; slug: string; kind: "physical" | "digital" | "service" | "rental" | "bundle" | "pass"; subtitle: string | null; description: unknown; brand: string | null; status: "draft" | "active" | "archived"; visibility: "public" | "unlisted" | "member_only"; taxCategoryId: string | null; seo: unknown; workingName: string | null; workingSubtitle: string | null; workingDescription: unknown | null; workingSeo: unknown | null; schemaType: string; publishedAt: string | null; archivedAt: string | null; version: number; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "catalog.removeCartItem": {
    input: { cartId: string; variantId: string };
    output: { cart: { id: string; token: string; contactId: string | null; currency: string; kind: "cart" | "saved"; status: "open" | "converted" | "abandoned"; name: string | null; lastActivityAt: string; abandonedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }; lines: { id: string; cartId: string; variantId: string; locationId: string | null; quantity: number; reservationId: string | null; galleryId: string | null; assetId: string | null; createdAt: string; updatedAt: string; sku: string; productName: string; requiresShipping: boolean; weightG: number | null; lengthMm: number | null; widthMm: number | null; heightMm: number | null; unitAmountMinor: number | null; lineTotalMinor: number | null; priceAvailable: boolean; priceReason: string | null; stock: { tracked: false; available: boolean; quantity?: number } | { tracked: true; available: boolean; backordered: boolean; restockAt: string | null; onHand: number; reserved: number; incoming: number; canPromise: number }; [key: string]: unknown }[]; subtotalMinor: number; allPriced: boolean; allAvailable: boolean };
  };
  "catalog.removePriceRule": {
    input: { productId: string; mode: "full" | "deposit_balance" | "payment_plan" | "hourly" | "retainer" };
    output: { id: string; mode: "full" | "deposit_balance" | "payment_plan" | "hourly" | "retainer" };
  };
  "catalog.removeProductRelation": {
    input: { productId: string; expectedVersion: number; relationId: string };
    output: { id: string; name: string; slug: string; kind: "physical" | "digital" | "service" | "rental" | "bundle" | "pass"; subtitle: string | null; description: unknown; brand: string | null; status: "draft" | "active" | "archived"; visibility: "public" | "unlisted" | "member_only"; taxCategoryId: string | null; seo: unknown; workingName: string | null; workingSubtitle: string | null; workingDescription: unknown | null; workingSeo: unknown | null; schemaType: string; publishedAt: string | null; archivedAt: string | null; version: number; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "catalog.removeWishlistItem": {
    input: { contactId: string; variantId: string };
    output: { wishlist: { id: string; contactId: string; name: string; createdAt: string; updatedAt: string; [key: string]: unknown } | null; items: { id: string; variantId: string; sku: string; productName: string; [key: string]: unknown }[] };
  };
  "catalog.requestReturn": {
    input: { orderId: string; reason: string; restock?: boolean; items: { orderItemId: string; quantity: number }[] };
    output: { return: { id: string; orderId: string; contactId: string; status: "requested" | "approved" | "received" | "refunded" | "rejected"; reason: string; restock: boolean; labelUrl: string | null; creditNoteId: string | null; refundId: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }; items: { id: string; returnId: string; orderItemId: string; quantity: number; restockedQuantity: number; createdAt: string; [key: string]: unknown }[] };
  };
  "catalog.reserveStock": {
    input: { variantId: string; locationId: string; quantity: number; holderType: "cart" | "order" | "booking"; holderId: string; expiresAt: string };
    output: { tracked: false; reservation: null } | { tracked: true; reservation: { id: string; inventoryItemId: string; quantity: number; holderType: "cart" | "order" | "booking"; holderId: string; expiresAt: string; status: "active" | "consumed" | "released" | "expired"; createdAt: string; updatedAt: string; [key: string]: unknown }; balance: { onHand: number; reserved: number; incoming: number; available: number } };
  };
  "catalog.resolvePrice": {
    input: { variantId: string; currency: string; contactId?: string; quantity?: number; at?: string };
    output: { available: false; currency: string; variantId: string; quantity: number; reason: string } | { available: true; currency: string; variantId: string; quantity: number; amountMinor: number; totalMinor: number; compareAtMinor: number | null; priceListId: string; priceListName: string; kind: "retail" | "wholesale" | "member" | "sale" | "contract"; breakMode: ("volume" | "tiered") | null; breakdown: { qty: number; unitMinor: number }[]; reason: string };
  };
  "catalog.resolveVisibleProduct": {
    input: { slug: string };
    output: { id: string; name: string; slug: string; kind: "physical" | "digital" | "service" | "rental" | "bundle" | "pass"; subtitle: string | null; description: unknown; brand: string | null; visibility: "public" | "unlisted" | "member_only"; taxCategoryId: string | null; seo: unknown; schemaType: string; publishedAt: string | null; updatedAt: string; [key: string]: unknown } | null;
  };
  "catalog.restoreProduct": {
    input: { id: string; expectedVersion: number; reason: string };
    output: { id: string; name: string; slug: string; kind: "physical" | "digital" | "service" | "rental" | "bundle" | "pass"; subtitle: string | null; description: unknown; brand: string | null; status: "draft" | "active" | "archived"; visibility: "public" | "unlisted" | "member_only"; taxCategoryId: string | null; seo: unknown; workingName: string | null; workingSubtitle: string | null; workingDescription: unknown | null; workingSeo: unknown | null; schemaType: string; publishedAt: string | null; archivedAt: string | null; version: number; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "catalog.revokeWishlistShare": {
    input: { contactId?: string };
    output: { ok: true };
  };
  "catalog.saveCart": {
    input: { cartId: string; name: string };
    output: { cart: { id: string; token: string; contactId: string | null; currency: string; kind: "cart" | "saved"; status: "open" | "converted" | "abandoned"; name: string | null; lastActivityAt: string; abandonedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }; lines: { id: string; cartId: string; variantId: string; locationId: string | null; quantity: number; reservationId: string | null; galleryId: string | null; assetId: string | null; createdAt: string; updatedAt: string; sku: string; productName: string; requiresShipping: boolean; weightG: number | null; lengthMm: number | null; widthMm: number | null; heightMm: number | null; unitAmountMinor: number | null; lineTotalMinor: number | null; priceAvailable: boolean; priceReason: string | null; stock: { tracked: false; available: boolean; quantity?: number } | { tracked: true; available: boolean; backordered: boolean; restockAt: string | null; onHand: number; reserved: number; incoming: number; canPromise: number }; [key: string]: unknown }[]; subtotalMinor: number; allPriced: boolean; allAvailable: boolean };
  };
  "catalog.sendGiftCard": {
    input: { id: string; email: string; name?: string };
    output: { id: string; contactId: string; token: string; link: string; delivers: boolean };
  };
  "catalog.setCartItemQuantity": {
    input: { cartId: string; variantId: string; quantity: number; locationId?: string };
    output: { cart: { id: string; token: string; contactId: string | null; currency: string; kind: "cart" | "saved"; status: "open" | "converted" | "abandoned"; name: string | null; lastActivityAt: string; abandonedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }; lines: { id: string; cartId: string; variantId: string; locationId: string | null; quantity: number; reservationId: string | null; galleryId: string | null; assetId: string | null; createdAt: string; updatedAt: string; sku: string; productName: string; requiresShipping: boolean; weightG: number | null; lengthMm: number | null; widthMm: number | null; heightMm: number | null; unitAmountMinor: number | null; lineTotalMinor: number | null; priceAvailable: boolean; priceReason: string | null; stock: { tracked: false; available: boolean; quantity?: number } | { tracked: true; available: boolean; backordered: boolean; restockAt: string | null; onHand: number; reserved: number; incoming: number; canPromise: number }; [key: string]: unknown }[]; subtotalMinor: number; allPriced: boolean; allAvailable: boolean };
  };
  "catalog.setDefaultVariant": {
    input: { productId: string; expectedVersion: number; variantId: string };
    output: { id: string; name: string; slug: string; kind: "physical" | "digital" | "service" | "rental" | "bundle" | "pass"; subtitle: string | null; description: unknown; brand: string | null; status: "draft" | "active" | "archived"; visibility: "public" | "unlisted" | "member_only"; taxCategoryId: string | null; seo: unknown; workingName: string | null; workingSubtitle: string | null; workingDescription: unknown | null; workingSeo: unknown | null; schemaType: string; publishedAt: string | null; archivedAt: string | null; version: number; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "catalog.setInventoryLevels": {
    input: { itemId: string; safetyStock: number; reorderPoint: number; bin?: string | null };
    output: { id: string; variantId: string; locationId: string; bin: string | null; safetyStock: number; reorderPoint: number; incoming: number; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "catalog.setPriceBreak": {
    input: { priceListId: string; variantId?: string; mode: "volume" | "tiered"; minQty: number; maxQty?: number; amount?: string; percentOffPpm?: number };
    output: { id: string; priceListId: string; variantId: string | null; mode: "volume" | "tiered"; minQty: number; maxQty: number | null; unitAmountMinor: number | null; percentOffPpm: number | null; createdAt: string; [key: string]: unknown };
  };
  "catalog.setPriceListEntry": {
    input: { priceListId: string; variantId: string; amount: string; compareAt?: string };
    output: { id: string; priceListId: string; variantId: string; amountMinor: number; compareAtMinor: number | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "catalog.setPriceRule": {
    input: { productId: string; mode: "full" | "deposit_balance" | "payment_plan" | "hourly" | "retainer"; installmentCount?: number; intervalDays?: number; periodDays?: number };
    output: { id: string; productId: string; mode: "full" | "deposit_balance" | "payment_plan" | "hourly" | "retainer"; planSchedule: unknown; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "catalog.setProductAttribute": {
    input: { productId: string; expectedVersion: number; attributeId: string; text?: string; number?: string; bool?: boolean; enum?: string };
    output: { id: string; name: string; slug: string; kind: "physical" | "digital" | "service" | "rental" | "bundle" | "pass"; subtitle: string | null; description: unknown; brand: string | null; status: "draft" | "active" | "archived"; visibility: "public" | "unlisted" | "member_only"; taxCategoryId: string | null; seo: unknown; workingName: string | null; workingSubtitle: string | null; workingDescription: unknown | null; workingSeo: unknown | null; schemaType: string; publishedAt: string | null; archivedAt: string | null; version: number; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "catalog.setProductOptionValues": {
    input: { productId: string; expectedVersion: number; optionTypeId: string; optionValueIds: string[] };
    output: { id: string; name: string; slug: string; kind: "physical" | "digital" | "service" | "rental" | "bundle" | "pass"; subtitle: string | null; description: unknown; brand: string | null; status: "draft" | "active" | "archived"; visibility: "public" | "unlisted" | "member_only"; taxCategoryId: string | null; seo: unknown; workingName: string | null; workingSubtitle: string | null; workingDescription: unknown | null; workingSeo: unknown | null; schemaType: string; publishedAt: string | null; archivedAt: string | null; version: number; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "catalog.setVariantStockPolicy": {
    input: { variantId: string; backorderPolicy: "refuse" | "allow_date" | "allow_silent"; expectedRestockAt?: string | null };
    output: { id: string; productId: string; combinationKey: string; sku: string; isDefault: boolean; status: "active" | "archived"; backorderPolicy: "refuse" | "allow_date" | "allow_silent"; expectedRestockAt: string | null; requiresShipping: boolean; weightG: number | null; lengthMm: number | null; widthMm: number | null; heightMm: number | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "catalog.shareWishlist": {
    input: { contactId?: string };
    output: { id: string; token: string; link: string };
  };
  "catalog.shipFulfillment": {
    input: { id: string; carrier?: string; service?: string; trackingNumber?: string; trackingUrl?: string };
    output: { fulfillment: { id: string; orderId: string; locationId: string | null; kind: "physical" | "digital"; status: "pending" | "picking" | "packed" | "shipped" | "delivered" | "failed" | "returned"; boxId: string | null; weightG: number | null; carrier: string | null; service: string | null; trackingNumber: string | null; trackingUrl: string | null; shippedAt: string | null; deliveredAt: string | null; note: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }; items: { id: string; fulfillmentId: string; orderItemId: string; quantity: number; createdAt: string; [key: string]: unknown }[] };
  };
  "catalog.subscribeBackInStock": {
    input: { variantId: string; contactId: string; locationId?: string };
    output: { id: string; variantId: string; contactId: string; locationId: string | null; notifiedAt: string | null; createdAt: string; [key: string]: unknown };
  };
  "catalog.transferStock": {
    input: { fromItemId: string; toLocationId: string; quantity: number; note?: string };
    output: { transferId: string; outgoing: { id: string; inventoryItemId: string; delta: number; reason: "sale" | "return" | "adjustment" | "transfer" | "receipt" | "damage" | "count"; referenceType: string | null; referenceId: string | null; actor: string; note: string | null; createdAt: string; [key: string]: unknown }; incoming: { id: string; inventoryItemId: string; delta: number; reason: "sale" | "return" | "adjustment" | "transfer" | "receipt" | "damage" | "count"; referenceType: string | null; referenceId: string | null; actor: string; note: string | null; createdAt: string; [key: string]: unknown }; from: { onHand: number; reserved: number; incoming: number; available: number }; to: { onHand: number; reserved: number; incoming: number; available: number } };
  };
  "catalog.updateProduct": {
    input: { id: string; expectedVersion: number; name?: string; slug?: string; kind?: "physical" | "digital" | "service" | "rental" | "bundle" | "pass"; subtitle?: string | null; brand?: string | null; visibility?: "public" | "unlisted" | "member_only"; taxCategoryId?: string | null; seo?: { title?: string; description?: string } };
    output: { id: string; name: string; slug: string; kind: "physical" | "digital" | "service" | "rental" | "bundle" | "pass"; subtitle: string | null; description: unknown; brand: string | null; status: "draft" | "active" | "archived"; visibility: "public" | "unlisted" | "member_only"; taxCategoryId: string | null; seo: unknown; workingName: string | null; workingSubtitle: string | null; workingDescription: unknown | null; workingSeo: unknown | null; schemaType: string; publishedAt: string | null; archivedAt: string | null; version: number; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "catalog.updateProductDescription": {
    input: { id: string; expectedVersion: number; description: unknown };
    output: { id: string; name: string; slug: string; kind: "physical" | "digital" | "service" | "rental" | "bundle" | "pass"; subtitle: string | null; description: unknown; brand: string | null; status: "draft" | "active" | "archived"; visibility: "public" | "unlisted" | "member_only"; taxCategoryId: string | null; seo: unknown; workingName: string | null; workingSubtitle: string | null; workingDescription: unknown | null; workingSeo: unknown | null; schemaType: string; publishedAt: string | null; archivedAt: string | null; version: number; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "catalog.upsertServiceOffering": {
    input: { productId: string; durationMin: number; bufferBeforeMin?: number; bufferAfterMin?: number; locationType: "in_person" | "virtual" | "client_site"; depositType?: "none" | "fixed" | "percent"; depositAmount?: string; depositPercentPpm?: number; currency?: string; cancellationPolicyId?: string | null; intakeFormId?: string | null; waiverTemplateId?: string | null; waiverTitle?: string | null; waiverBody?: string | null; reminderOffsetsMin?: number[]; capacity?: number; assignment?: "specific" | "pool" | "round_robin"; calendarIds?: string[]; travelTimeMin?: number };
    output: { id: string; productId: string; durationMin: number; bufferBeforeMin: number; bufferAfterMin: number; locationType: "in_person" | "virtual" | "client_site"; depositType: "none" | "fixed" | "percent"; depositValue: number; cancellationPolicyId: string | null; intakeFormId: string | null; waiverTemplateId: string | null; waiverTitle: string | null; waiverBody: string | null; reminderOffsetsMin: number[]; capacity: number; assignment: "specific" | "pool" | "round_robin"; calendarIds: string[]; travelTimeMin: number; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "catalog.verifyDemoFixture": {
    input: { scenarioKey: string; scenarioVersion: number; runId: string; generation: number; locale: string; records?: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
    output: { outcomes: { key: string; achieved: boolean; detail?: string }[] };
  };
  "catalog.wishlistByShareToken": {
    input: { token: string };
    output: { name: string; items: { id: string; sku: string; productName: string; href: string | null; [key: string]: unknown }[] } | null;
  };
  "catalogue.addSource": {
    input: { name: string; url: string };
    output: { id: string; name: string; url: string; enabled: boolean; lastFetchedAt: string | null; lastError: string | null; [key: string]: unknown };
  };
  "catalogue.install": {
    input: { id: string; approvedChecksum: string; name?: string };
    output: { installedId: string; kind: "playbook" | "agent"; name: string };
  };
  "catalogue.installs": {
    input: Record<string, never>;
    output: { id: string; sourceUrl: string; slug: string; kind: "playbook" | "agent"; version: string; checksum: string; installedId: string | null; createdAt: string }[];
  };
  "catalogue.list": {
    input: { kind?: "playbook" | "agent" };
    output: { id: string; sourceId: string; slug: string; kind: "playbook" | "agent"; name: string; description: string; version: string; freeholderRange: string | null; declaredScopes: string[]; author: string | null; license: string | null; checksum: string; fetchedAt: string; compatible: boolean; sourceName: string; [key: string]: unknown }[];
  };
  "catalogue.preview": {
    input: { id: string };
    output: { id: string; sourceId: string; slug: string; kind: "playbook" | "agent"; name: string; description: string; version: string; freeholderRange: string | null; declaredScopes: string[]; author: string | null; license: string | null; checksum: string; fetchedAt: string; sourceName: string; sourceUrl: string; compatible: boolean; incompatibleReason: string | null; brief: string | null; document: unknown; [key: string]: unknown } | null;
  };
  "catalogue.refresh": {
    input: { id: string };
    output: { id: string; jobId: string; queued: true };
  };
  "catalogue.removeSource": {
    input: { id: string };
    output: { id: string };
  };
  "catalogue.sources": {
    input: Record<string, never>;
    output: { id: string; name: string; url: string; enabled: boolean; lastFetchedAt: string | null; lastError: string | null; [key: string]: unknown }[];
  };
  "cms.addComment": {
    input: { pageId: string; body: string; blockId?: string; revisionId?: string; parentId?: string; mentions?: string[] };
    output: { id: string; pageId: string; revisionId: string | null; blockId: string | null; parentId: string | null; body: string; mentions: string[]; kind: "comment" | "review_request"; reviewer: string | null; reviewState: "none" | "requested" | "approved" | "changes_requested"; resolvedAt: string | null; resolvedBy: string | null; createdBy: string; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "cms.applyDueSchedules": {
    input: Record<string, never>;
    output: { published: string[]; unpublished: string[] };
  };
  "cms.attachLayout": {
    input: { pageId: string; entityType: "product" | "service" | "post" | "location" | "event" | "gallery" | "page"; entityId: string; templateKey: string; detached?: boolean };
    output: { id: string; pageId: string; entityType: "product" | "service" | "post" | "location" | "event" | "gallery" | "page"; entityId: string; templateKey: string; detached: boolean; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "cms.compareRevisions": {
    input: { pageId?: string; fromRevisionId?: string; toRevisionId?: string };
    output: { earlier: { id: string; label: string; title: string }; later: { id: string; label: string; title: string }; titleChanged: boolean; blocks: { added: { id: string; type: string }[]; removed: { id: string; type: string }[]; changed: { id: string; type: string }[]; unchanged: number } };
  };
  "cms.createFromTemplate": {
    input: { key: string; title: string; slug?: string; preset?: "creator" | "service-business" | "shop" | "everything" | "custom"; locale?: string };
    output: { kind: "page" | "post" | "product" | "service" | "email" | "sms"; templateKey: string; blocks: unknown; page: { id: string; slug: string; locale: string; title: string; blocks: unknown; status: "draft" | "published"; publishedAt: string | null; seo: unknown; workingTitle: string | null; workingBlocks: unknown | null; workingSeo: unknown | null; version: number; createdAt: string; updatedAt: string; [key: string]: unknown } | null };
  };
  "cms.createPage": {
    input: { slug: string; locale?: string; title: string; blocks?: unknown; seo?: { title?: string; description?: string; ogImage?: string } };
    output: { id: string; slug: string; locale: string; title: string; blocks: unknown; status: "draft" | "published"; publishedAt: string | null; seo: unknown; workingTitle: string | null; workingBlocks: unknown | null; workingSeo: unknown | null; version: number; scheduledPublishAt: string | null; scheduledUnpublishAt: string | null; approvalState: "none" | "pending" | "approved" | "rejected"; approvalNote: string | null; approvedBy: string | null; approvedAt: string | null; editLeaseActor: string | null; editLeaseUntil: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "cms.createPreviewLink": {
    input: { pageId: string; expiresInHours?: number };
    output: { id: string; token: string; path: string; expiresAt: string };
  };
  "cms.createSection": {
    input: { name: string; locale?: string; blocks: unknown; key?: string };
    output: { id: string; key: string; locale: string; name: string; kind: "chrome" | "reusable"; blocks: unknown; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "cms.createSectionLocale": {
    input: { key: string; locale: string };
    output: { id: string; key: string; locale: string; name: string; kind: "chrome" | "reusable"; blocks: unknown; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "cms.decideApproval": {
    input: { id: string; approved: boolean; note?: string };
    output: { id: string; slug: string; locale: string; title: string; blocks: unknown; status: "draft" | "published"; publishedAt: string | null; seo: unknown; workingTitle: string | null; workingBlocks: unknown | null; workingSeo: unknown | null; version: number; scheduledPublishAt: string | null; scheduledUnpublishAt: string | null; approvalState: "none" | "pending" | "approved" | "rejected"; approvalNote: string | null; approvedBy: string | null; approvedAt: string | null; editLeaseActor: string | null; editLeaseUntil: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "cms.decideReview": {
    input: { id: string; approved: boolean; note?: string };
    output: { id: string; pageId: string; revisionId: string | null; blockId: string | null; parentId: string | null; body: string; mentions: string[]; kind: "comment" | "review_request"; reviewer: string | null; reviewState: "none" | "requested" | "approved" | "changes_requested"; resolvedAt: string | null; resolvedBy: string | null; createdBy: string; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "cms.deleteDraftPage": {
    input: { id: string };
    output: { id: string; slug: string; [key: string]: unknown };
  };
  "cms.deleteHelpCategory": {
    input: { id: string };
    output: { ok: true; uncategorised: number; [key: string]: unknown };
  };
  "cms.deleteSection": {
    input: { key: string };
    output: { key: string; deleted: number };
  };
  "cms.describeConflict": {
    input: { pageId: string; expectedVersion: number; title?: string; blocks?: unknown; seo?: unknown };
    output: { stale: boolean; server: { version: number; title: string; blocks: unknown; seo: unknown }; incoming: { title: string; blocks: unknown; seo: unknown }; titleChanged: boolean; blocks: { added: { id: string; type: string }[]; removed: { id: string; type: string }[]; changed: { id: string; type: string }[]; unchanged: number } };
  };
  "cms.detachLayout": {
    input: { pageId: string };
    output: { id: string; pageId: string; entityType: "product" | "service" | "post" | "location" | "event" | "gallery" | "page"; entityId: string; templateKey: string; detached: boolean; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "cms.detachSection": {
    input: { sectionKey: string; locale?: string };
    output: { nodes: unknown };
  };
  "cms.draftPageTranslation": {
    input: { pageId: string; locale: string; replace?: boolean };
    output: { id: string; entityType: string; entityId: string; locale: string; fields: unknown; status: "draft" | "machine" | "reviewed"; translatedBy: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "cms.ensureDefaults": {
    input: { locale?: string };
    output: { created: string[] };
  };
  "cms.ensureTemplates": {
    input: { locale?: string };
    output: { created: string[] };
  };
  "cms.expireStalePresence": {
    input: Record<string, never>;
    output: { removed: number };
  };
  "cms.fileHelpArticle": {
    input: { pageId: string; categoryId: string | null };
    output: { id: string; categoryId: string | null; [key: string]: unknown };
  };
  "cms.getLayout": {
    input: { pageId: string };
    output: { id: string; pageId: string; entityType: "product" | "service" | "post" | "location" | "event" | "gallery" | "page"; entityId: string; templateKey: string; detached: boolean; createdAt: string; updatedAt: string; [key: string]: unknown } | null;
  };
  "cms.getPage": {
    input: { id: string };
    output: { id: string; slug: string; locale: string; title: string; blocks: unknown; status: "draft" | "published"; publishedAt: string | null; seo: unknown; workingTitle: string | null; workingBlocks: unknown | null; workingSeo: unknown | null; version: number; scheduledPublishAt: string | null; scheduledUnpublishAt: string | null; approvalState: "none" | "pending" | "approved" | "rejected"; approvalNote: string | null; approvedBy: string | null; approvedAt: string | null; editLeaseActor: string | null; editLeaseUntil: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "cms.getSection": {
    input: { key: string; locale?: string; fallback?: boolean };
    output: { id: string; key: string; locale: string; name: string; kind: "chrome" | "reusable"; blocks: unknown; createdAt: string; updatedAt: string; [key: string]: unknown } | null;
  };
  "cms.getTemplate": {
    input: { key: string; preset?: "creator" | "service-business" | "shop" | "everything" | "custom"; locale?: string };
    output: { id: string; key: string; kind: "page" | "post" | "product" | "service" | "email" | "sms"; preset: "creator" | "service-business" | "shop" | "everything" | "custom"; name: string; locale: string; blocks: unknown; variables: string[]; origin: "system" | "owner"; createdAt: string; updatedAt: string; [key: string]: unknown } | null;
  };
  "cms.heartbeatPresence": {
    input: { pageId: string; editing?: boolean };
    output: { pageId: string; actor: string; editing: boolean; lastSeenAt: string; [key: string]: unknown };
  };
  "cms.helpArticleAt": {
    input: { slug: string; locale?: string };
    output: { id: string; slug: string; locale: string; title: string; categoryId: string | null; categorySlug: string | null; categoryName: string | null; helpfulYes: number; helpfulNo: number; updatedAt: string; [key: string]: unknown } | null;
  };
  "cms.helpArticleFeedback": {
    input: { locale?: string };
    output: { id: string; slug: string; locale: string; title: string; categoryId: string | null; categorySlug: string | null; categoryName: string | null; helpfulYes: number; helpfulNo: number; updatedAt: string; [key: string]: unknown }[];
  };
  "cms.helpArticles": {
    input: { locale?: string; categorySlug?: string; limit?: number };
    output: { id: string; slug: string; locale: string; title: string; categoryId: string | null; categorySlug: string | null; categoryName: string | null; helpfulYes: number; helpfulNo: number; updatedAt: string; [key: string]: unknown }[];
  };
  "cms.helpCategories": {
    input: { locale?: string };
    output: { id: string; slug: string; locale: string; name: string; description: string | null; position: number; articleCount: number; [key: string]: unknown }[];
  };
  "cms.leavePresence": {
    input: { pageId: string };
    output: { pageId: string };
  };
  "cms.listComments": {
    input: { pageId: string; includeResolved?: boolean };
    output: { id: string; pageId: string; revisionId: string | null; blockId: string | null; parentId: string | null; body: string; mentions: string[]; kind: "comment" | "review_request"; reviewer: string | null; reviewState: "none" | "requested" | "approved" | "changes_requested"; resolvedAt: string | null; resolvedBy: string | null; createdBy: string; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "cms.listPages": {
    input: Record<string, never>;
    output: { id: string; slug: string; locale: string; title: string; blocks: unknown; status: "draft" | "published"; publishedAt: string | null; seo: unknown; workingTitle: string | null; workingBlocks: unknown | null; workingSeo: unknown | null; version: number; scheduledPublishAt: string | null; scheduledUnpublishAt: string | null; approvalState: "none" | "pending" | "approved" | "rejected"; approvalNote: string | null; approvedBy: string | null; approvedAt: string | null; editLeaseActor: string | null; editLeaseUntil: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "cms.listPresence": {
    input: { pageId: string };
    output: { actor: string; editing: boolean; lastSeenAt: string; [key: string]: unknown }[];
  };
  "cms.listPreviewLinks": {
    input: { pageId: string };
    output: { id: string; expiresAt: string; createdBy: string; revokedAt: string | null; createdAt: string; [key: string]: unknown }[];
  };
  "cms.listRevisions": {
    input: { subjectType: "page" | "section"; subjectId: string; actor?: string; limit?: number };
    output: { id: string; subjectType: "page" | "section"; subjectId: string; title: string | null; blocks: unknown; seo: unknown; name: string | null; kind: "create" | "autosave" | "named" | "publish" | "unpublish" | "restore" | "schedule" | "approval"; actor: string; authorKind: "user" | "agent" | "system" | "anonymous"; authorId: string | null; authorLabel: string; createdAt: string; [key: string]: unknown }[];
  };
  "cms.listSectionUsages": {
    input: { key: string };
    output: { kind: "page" | "section"; title: string; id: string; [key: string]: unknown }[];
  };
  "cms.listSections": {
    input: Record<string, never>;
    output: { id: string; key: string; locale: string; name: string; kind: "chrome" | "reusable"; blocks: unknown; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "cms.listTemplates": {
    input: { kind?: "page" | "post" | "product" | "service" | "email" | "sms"; preset?: "creator" | "service-business" | "shop" | "everything" | "custom"; locale?: string };
    output: { id: string; key: string; kind: "page" | "post" | "product" | "service" | "email" | "sms"; preset: "creator" | "service-business" | "shop" | "everything" | "custom"; name: string; locale: string; blocks: unknown; variables: string[]; origin: "system" | "owner"; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "cms.loadDemoFixture": {
    input: { scenarioKey: string; scenarioVersion: number; runId: string; generation: number; locale: string; records?: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
    output: { records: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
  };
  "cms.mergePage": {
    input: { id: string; expectedVersion: number; title?: string; blocks?: unknown; seo?: { title?: string; description?: string; ogImage?: string } };
    output: { id: string; slug: string; locale: string; title: string; blocks: unknown; status: "draft" | "published"; publishedAt: string | null; seo: unknown; workingTitle: string | null; workingBlocks: unknown | null; workingSeo: unknown | null; version: number; scheduledPublishAt: string | null; scheduledUnpublishAt: string | null; approvalState: "none" | "pending" | "approved" | "rejected"; approvalNote: string | null; approvedBy: string | null; approvedAt: string | null; editLeaseActor: string | null; editLeaseUntil: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "cms.nameRevision": {
    input: { revisionId: string; name: string };
    output: { id: string; subjectType: "page" | "section"; subjectId: string; title: string | null; blocks: unknown; seo: unknown; name: string | null; kind: "create" | "autosave" | "named" | "publish" | "unpublish" | "restore" | "schedule" | "approval"; actor: string; createdAt: string; [key: string]: unknown };
  };
  "cms.pageAccessibilityReport": {
    input: { id: string };
    output: { hints: { code: "missingH1" | "multipleH1" | "headingOrder" | "imageMissing" | "imageAltUnset" | "vagueLink" | "emptyHref" | "htmlImage" | "htmlLandmarks" | "videoMissing"; severity: "error" | "warning"; blockId?: string; [key: string]: unknown }[] };
  };
  "cms.pageAuthorSummary": {
    input: { pageId: string };
    output: { created: { at: string; actor: string; authorKind: "user" | "agent" | "system" | "anonymous"; authorId: string | null; authorLabel: string; kind: string; [key: string]: unknown } | null; lastEdited: { at: string; actor: string; authorKind: "user" | "agent" | "system" | "anonymous"; authorId: string | null; authorLabel: string; kind: string; [key: string]: unknown } | null; lastPublished: { at: string; actor: string; authorKind: "user" | "agent" | "system" | "anonymous"; authorId: string | null; authorLabel: string; kind: string; [key: string]: unknown } | null; authors: { actor: string; kind: string; id: string | null; label: string; [key: string]: unknown }[] };
  };
  "cms.pageTranslationReport": {
    input: { locale: string };
    output: { pageId: string; title: string; slug: string; status: "draft" | "machine" | "reviewed" | "missing"; seoComplete: boolean; [key: string]: unknown }[];
  };
  "cms.previewEmail": {
    input: { key: string; locale?: string; subject?: string; variables?: { [key: string]: string } };
    output: { subject: string; html: string; text: string; variables: { [key: string]: string } };
  };
  "cms.previewSms": {
    input: { key: string; contactId?: string; bookingId?: string; locale?: string; variables?: { [key: string]: string } };
    output: { templateId: string; locale: string; timezone: string; body: string; variables: { [key: string]: string }; estimatedSegments: number; [key: string]: unknown };
  };
  "cms.previewTemplate": {
    input: { key: string; preset?: "creator" | "service-business" | "shop" | "everything" | "custom"; locale?: string };
    output: { id: string; key: string; kind: "page" | "post" | "product" | "service" | "email" | "sms"; preset: "creator" | "service-business" | "shop" | "everything" | "custom"; name: string; locale: string; blocks: unknown; variables: string[]; origin: "system" | "owner"; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "cms.publishPage": {
    input: { id: string; published: boolean };
    output: { id: string; slug: string; locale: string; title: string; blocks: unknown; status: "draft" | "published"; publishedAt: string | null; seo: unknown; workingTitle: string | null; workingBlocks: unknown | null; workingSeo: unknown | null; version: number; scheduledPublishAt: string | null; scheduledUnpublishAt: string | null; approvalState: "none" | "pending" | "approved" | "rejected"; approvalNote: string | null; approvedBy: string | null; approvedAt: string | null; editLeaseActor: string | null; editLeaseUntil: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "cms.publishedPaths": {
    input: { locale?: string };
    output: { slug: string; title: string; description?: string; imageUrl: string | null; kind: "page" | "section" | "product" | "location" | "event" | "newsletter" | "article" | "service" | "project" | "collection"; priority: number; updatedAt: string; [key: string]: unknown }[];
  };
  "cms.purgeDemoFixture": {
    input: { scenarioKey: string; scenarioVersion: number; runId: string; generation: number; locale: string; records?: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
    output: { purged: { subjectType: string; subjectId: string }[] };
  };
  "cms.rateHelpArticle": {
    input: { articleId: string; helpful: boolean };
    output: { helpfulYes: number; helpfulNo: number; [key: string]: unknown };
  };
  "cms.rejoinLayout": {
    input: { pageId: string; bindings?: { title?: string; slug?: string; productId?: string; locationId?: string; eventId?: string }; locale?: string };
    output: { layout: { id: string; pageId: string; entityType: "product" | "service" | "post" | "location" | "event" | "gallery" | "page"; entityId: string; templateKey: string; detached: boolean; createdAt: string; updatedAt: string; [key: string]: unknown }; blocks: unknown };
  };
  "cms.releaseEditLease": {
    input: { id: string };
    output: { id: string };
  };
  "cms.reloadWorkingDraft": {
    input: { pageId: string };
    output: { id: string; version: number; title: string; blocks: unknown; seo: unknown; [key: string]: unknown };
  };
  "cms.reopenThread": {
    input: { id: string };
    output: { id: string; pageId: string; revisionId: string | null; blockId: string | null; parentId: string | null; body: string; mentions: string[]; kind: "comment" | "review_request"; reviewer: string | null; reviewState: "none" | "requested" | "approved" | "changes_requested"; resolvedAt: string | null; resolvedBy: string | null; createdBy: string; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "cms.requestApproval": {
    input: { id: string; note?: string };
    output: { id: string; slug: string; locale: string; title: string; blocks: unknown; status: "draft" | "published"; publishedAt: string | null; seo: unknown; workingTitle: string | null; workingBlocks: unknown | null; workingSeo: unknown | null; version: number; scheduledPublishAt: string | null; scheduledUnpublishAt: string | null; approvalState: "none" | "pending" | "approved" | "rejected"; approvalNote: string | null; approvedBy: string | null; approvedAt: string | null; editLeaseActor: string | null; editLeaseUntil: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "cms.requestReview": {
    input: { pageId: string; reviewer: string; body: string; blockId?: string; revisionId?: string; mentions?: string[] };
    output: { id: string; pageId: string; revisionId: string | null; blockId: string | null; parentId: string | null; body: string; mentions: string[]; kind: "comment" | "review_request"; reviewer: string | null; reviewState: "none" | "requested" | "approved" | "changes_requested"; resolvedAt: string | null; resolvedBy: string | null; createdBy: string; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "cms.resetTemplate": {
    input: { key: string; preset?: "creator" | "service-business" | "shop" | "everything" | "custom"; locale?: string };
    output: { id: string; key: string; kind: "page" | "post" | "product" | "service" | "email" | "sms"; preset: "creator" | "service-business" | "shop" | "everything" | "custom"; name: string; locale: string; blocks: unknown; variables: string[]; origin: "system" | "owner"; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "cms.resolvePage": {
    input: { slug: string; locale?: string };
    output: { id: string; slug: string; locale: string; title: string; blocks: unknown; status: "draft" | "published"; publishedAt: string | null; seo: unknown; workingTitle: string | null; workingBlocks: unknown | null; workingSeo: unknown | null; version: number; scheduledPublishAt: string | null; scheduledUnpublishAt: string | null; approvalState: "none" | "pending" | "approved" | "rejected"; approvalNote: string | null; approvedBy: string | null; approvedAt: string | null; editLeaseActor: string | null; editLeaseUntil: string | null; createdAt: string; updatedAt: string; [key: string]: unknown } | null;
  };
  "cms.resolvePreviewLink": {
    input: { token: string };
    output: { id: string; slug: string; locale: string; title: string; blocks: unknown; seo: unknown; expiresAt: string; [key: string]: unknown } | null;
  };
  "cms.resolveThread": {
    input: { id: string };
    output: { id: string; pageId: string; revisionId: string | null; blockId: string | null; parentId: string | null; body: string; mentions: string[]; kind: "comment" | "review_request"; reviewer: string | null; reviewState: "none" | "requested" | "approved" | "changes_requested"; resolvedAt: string | null; resolvedBy: string | null; createdBy: string; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "cms.restoreRevision": {
    input: { revisionId: string };
    output: { subjectType: "page"; id: string; version: number } | { subjectType: "section"; id: string };
  };
  "cms.revokePreviewLink": {
    input: { id: string };
    output: { id: string; revokedAt: string | null };
  };
  "cms.saveAsSection": {
    input: { name: string; locale?: string; nodes: { id: string; type: string; props: { [key: string]: unknown }; children?: unknown[] }[] };
    output: { section: { id: string; key: string; locale: string; name: string; kind: "chrome" | "reusable"; blocks: unknown; createdAt: string; updatedAt: string; [key: string]: unknown }; instance: unknown };
  };
  "cms.saveHelpCategory": {
    input: { id?: string; slug: string; locale?: string; name: string; description?: string | null; position?: number };
    output: { id: string; slug: string; [key: string]: unknown };
  };
  "cms.schedulePage": {
    input: { id: string; publishAt?: string | null; unpublishAt?: string | null };
    output: { id: string; slug: string; locale: string; title: string; blocks: unknown; status: "draft" | "published"; publishedAt: string | null; seo: unknown; workingTitle: string | null; workingBlocks: unknown | null; workingSeo: unknown | null; version: number; scheduledPublishAt: string | null; scheduledUnpublishAt: string | null; approvalState: "none" | "pending" | "approved" | "rejected"; approvalNote: string | null; approvedBy: string | null; approvedAt: string | null; editLeaseActor: string | null; editLeaseUntil: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "cms.searchHelp": {
    input: { q: string; locale?: string; limit?: number };
    output: { id: string; slug: string; locale: string; title: string; categoryId: string | null; categorySlug: string | null; categoryName: string | null; helpfulYes: number; helpfulNo: number; updatedAt: string; [key: string]: unknown }[];
  };
  "cms.sendSmsTemplate": {
    input: { key: string; contactId: string; bookingId?: string; purpose?: "transactional" | "marketing" | "support"; variables?: { [key: string]: string }; mediaAssetIds?: string[]; idempotencyKey: string };
    output: { sent: boolean; providerRef: string | null; reason: string | null; messageId: string | null; [key: string]: unknown };
  };
  "cms.snapshotRevision": {
    input: { pageId: string; name: string };
    output: { id: string; subjectType: "page" | "section"; subjectId: string; title: string | null; blocks: unknown; seo: unknown; name: string | null; kind: "create" | "autosave" | "named" | "publish" | "unpublish" | "restore" | "schedule" | "approval"; actor: string; createdAt: string; [key: string]: unknown };
  };
  "cms.submitQuoteRequest": {
    input: { name: string; email: string; message: string };
    output: { ok: true };
  };
  "cms.submitSiteChat": {
    input: { name: string; email: string; message: string; locale?: string };
    output: { ok: true; token: string; conversationId: string; contactId: string; [key: string]: unknown };
  };
  "cms.submitTipIntent": {
    input: { email: string; name?: string; amountMinor: number; currency: string; message?: string };
    output: { ok: true };
  };
  "cms.testSendEmail": {
    input: { key: string; locale?: string; subject?: string };
    output: { id: string; provider: "smtp" | "console" | "gmail" | "outlook" | "resend" | "postmark" | "ses" | "none"; providerRef: string | null; delivers: boolean; duplicate: boolean; [key: string]: unknown };
  };
  "cms.testSendSms": {
    input: { key: string; variables?: { [key: string]: string } };
    output: { sent: boolean; providerRef: string | null; reason: string | null; messageId: string | null; [key: string]: unknown };
  };
  "cms.touchEditLease": {
    input: { id: string; steal?: boolean };
    output: { held: boolean; by: string; until: string; mine: boolean };
  };
  "cms.updatePage": {
    input: { id: string; expectedVersion?: number; slug?: string; title?: string; blocks?: unknown; seo?: { title?: string; description?: string; ogImage?: string } };
    output: { id: string; slug: string; locale: string; title: string; blocks: unknown; status: "draft" | "published"; publishedAt: string | null; seo: unknown; workingTitle: string | null; workingBlocks: unknown | null; workingSeo: unknown | null; version: number; scheduledPublishAt: string | null; scheduledUnpublishAt: string | null; approvalState: "none" | "pending" | "approved" | "rejected"; approvalNote: string | null; approvedBy: string | null; approvedAt: string | null; editLeaseActor: string | null; editLeaseUntil: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "cms.updateSection": {
    input: { key: string; locale?: string; name?: string; blocks: unknown };
    output: { id: string; key: string; locale: string; name: string; kind: "chrome" | "reusable"; blocks: unknown; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "cms.updateTemplate": {
    input: { key: string; preset?: "creator" | "service-business" | "shop" | "everything" | "custom"; locale?: string; name?: string; blocks: unknown; variables?: string[] };
    output: { id: string; key: string; kind: "page" | "post" | "product" | "service" | "email" | "sms"; preset: "creator" | "service-business" | "shop" | "everything" | "custom"; name: string; locale: string; blocks: unknown; variables: string[]; origin: "system" | "owner"; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "cms.verifyDemoFixture": {
    input: { scenarioKey: string; scenarioVersion: number; runId: string; generation: number; locale: string; records?: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
    output: { outcomes: { key: string; achieved: boolean; detail?: string }[] };
  };
  "community.createSpace": {
    input: { slug: string; title: string; access?: "open" | "gated" };
    output: { id: string; slug: string; title: string; access: string; [key: string]: unknown };
  };
  "community.getBySlug": {
    input: { slug: string };
    output: { space: { id: string; slug: string; title: string; access: string; [key: string]: unknown }; memberCount: number; [key: string]: unknown };
  };
  "community.join": {
    input: { spaceId: string; contactId: string; role?: "member" | "moderator" };
    output: { id: string; spaceId: string; contactId: string; role: string; [key: string]: unknown };
  };
  "community.joinBySlug": {
    input: { slug: string; email: string; name: string };
    output: { id: string; spaceId: string; contactId: string; role: string; [key: string]: unknown };
  };
  "community.listMembers": {
    input: { spaceId: string };
    output: { id: string; spaceId: string; contactId: string; role: string; [key: string]: unknown }[];
  };
  "community.listSpaces": {
    input: Record<string, never>;
    output: { id: string; slug: string; title: string; access: string; [key: string]: unknown }[];
  };
  "connections.beginCalendarOAuth": {
    input: { provider: "google" | "microsoft"; access?: "read" | "write"; returnTo?: string };
    output: { authorizationUrl: string };
  };
  "connections.beginMailReadOAuth": {
    input: { provider: "google" | "microsoft"; returnTo?: string };
    output: { authorizationUrl: string };
  };
  "connections.busyWindows": {
    input: { from: string; to: string };
    output: { startsAt: string; endsAt: string }[];
  };
  "connections.calendarSources": {
    input: Record<string, never>;
    output: { id: string; accountId: string; account: string; provider: "google" | "microsoft" | "apple" | "caldav" | "imap"; name: string; role: "busy_source" | "bookable" | "ignored"; sharedWithBusiness: boolean; detailVisibility: "busy_only" | "full"; status: "active" | "needs_reconnect" | "revoked"; lastError: string | null; lastSyncAt: string | null; blocking: boolean }[];
  };
  "connections.completeCalendarOAuth": {
    input: { provider: "google" | "microsoft"; state: string; code: string };
    output: { connectedAccountId: string; email: string | null; access: "read" | "write"; scopes: string[]; returnTo: string };
  };
  "connections.completeMailReadOAuth": {
    input: { provider: "google" | "microsoft"; state: string; code: string };
    output: { connectedAccountId: string; email: string | null; scopes: string[]; returnTo: string };
  };
  "connections.flag": {
    input: { id: string; status: "needs_reconnect" | "revoked"; reason: string };
    output: { id: string };
  };
  "connections.grantToAgent": {
    input: { agentId: string; connectedAccountId: string; access?: "read" | "write" };
    output: { id: string; agentId: string; agentName: string; connectedAccountId: string; provider: string; email: string | null; access: "read" | "write"; revokedAt: string | null; createdAt: string; [key: string]: unknown };
  };
  "connections.grants": {
    input: { includeRevoked?: boolean };
    output: { id: string; agentId: string; agentName: string; connectedAccountId: string; provider: string; email: string | null; access: "read" | "write"; revokedAt: string | null; createdAt: string; [key: string]: unknown }[];
  };
  "connections.importMail": {
    input: { id: string };
    output: { accountId: string; messages: number; contactsCreated: number; timelineEvents: number };
  };
  "connections.list": {
    input: { mine?: boolean };
    output: { id: string; userId: string; provider: "google" | "microsoft" | "apple" | "caldav" | "imap"; email: string | null; displayName: string | null; kind: "personal" | "business"; scopesGranted: string[]; status: "active" | "needs_reconnect" | "revoked"; lastError: string | null; sharedWithBusiness: boolean; detailVisibility: "busy_only" | "full"; lastSyncAt: string | null; createdAt: string; [key: string]: unknown }[];
  };
  "connections.listCalendars": {
    input: { id: string };
    output: { id: string; externalId: string; name: string; colour: string | null; timezone: string | null; role: "busy_source" | "bookable" | "ignored"; lastSyncAt: string | null; events: number; [key: string]: unknown }[];
  };
  "connections.mine": {
    input: Record<string, never>;
    output: { id: string; provider: string; email: string | null; displayName: string | null; status: string; access: "read" | "write"; [key: string]: unknown }[];
  };
  "connections.record": {
    input: { userId: string; provider: "google" | "microsoft" | "apple" | "caldav" | "imap"; providerAccountId: string; email?: string | null; displayName?: string | null; kind?: "personal" | "business"; scopesGranted?: string[]; credentials: { [key: string]: unknown }; capabilities?: ("calendar_read" | "calendar_write" | "mail_read" | "mail_send" | "contacts_read" | "files_read")[] };
    output: { id: string };
  };
  "connections.remove": {
    input: { id: string };
    output: { id: string; provider: "google" | "microsoft" | "apple" | "caldav" | "imap" };
  };
  "connections.revokeFromAgent": {
    input: { agentId: string; connectedAccountId: string; reason?: string };
    output: { revoked: number };
  };
  "connections.rotateCredentials": {
    input: Record<string, never>;
    output: { examined: number; rotated: number; failed: number };
  };
  "connections.setCalendarRole": {
    input: { id: string; role: "busy_source" | "bookable" | "ignored" };
    output: { id: string; role: "busy_source" | "bookable" | "ignored" };
  };
  "connections.setCapability": {
    input: { id: string; capability: "calendar_read" | "calendar_write" | "mail_read" | "mail_send" | "contacts_read" | "files_read"; enabled: boolean };
    output: { id: string; connectedAccountId: string; capability: "calendar_read" | "calendar_write" | "mail_read" | "mail_send" | "contacts_read" | "files_read"; enabled: boolean; scopeString: string | null; grantedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "connections.setOptions": {
    input: { id: string; kind?: "personal" | "business"; sharedWithBusiness?: boolean; detailVisibility?: "busy_only" | "full" };
    output: { id: string; detailVisibility: "busy_only" | "full"; sharedWithBusiness: boolean; kind: "personal" | "business"; [key: string]: unknown };
  };
  "connections.syncCalendars": {
    input: { id: string };
    output: { accountId: string; calendars: number; events: number; removed: number; failed?: string };
  };
  "contactImports.begin": {
    input: { filename: string; csv: string; source?: string };
    output: { id: string; filename: string; delimiter: string; headers: string[]; mapping: string[]; source: string; sourceKind: "owner_csv" | "google" | "microsoft" | "vcard" | "csv" | "device"; signupFlow: "portal_account" | null; subjectContactId: string | null; allowedFields: string[]; status: "mapping" | "validated" | "committed" | "reverted" | "failed"; counts: unknown; error: string | null; committedAt: string | null; revertedAt: string | null; createdAt: string; [key: string]: unknown };
  };
  "contactImports.commit": {
    input: { id: string };
    output: { id: string; filename: string; delimiter: string; headers: string[]; mapping: string[]; source: string; sourceKind: "owner_csv" | "google" | "microsoft" | "vcard" | "csv" | "device"; signupFlow: "portal_account" | null; subjectContactId: string | null; allowedFields: string[]; status: "mapping" | "validated" | "committed" | "reverted" | "failed"; counts: unknown; error: string | null; committedAt: string | null; revertedAt: string | null; createdAt: string; [key: string]: unknown };
  };
  "contactImports.get": {
    input: { id: string; outcome?: "create" | "update" | "unchanged" | "skip" | "error"; limit?: number };
    output: { id: string; filename: string; delimiter: string; headers: string[]; mapping: string[]; source: string; sourceKind: "owner_csv" | "google" | "microsoft" | "vcard" | "csv" | "device"; signupFlow: "portal_account" | null; subjectContactId: string | null; allowedFields: string[]; status: "mapping" | "validated" | "committed" | "reverted" | "failed"; counts: unknown; error: string | null; committedAt: string | null; revertedAt: string | null; createdAt: string; rows: { id: string; lineNumber: number; cells: string[]; email: string | null; outcome: "create" | "update" | "unchanged" | "skip" | "error"; errors: string[]; changes: unknown; contactId: string | null; created: boolean; relationshipId: string | null; [key: string]: unknown }[]; [key: string]: unknown } | null;
  };
  "contactImports.list": {
    input: { limit?: number };
    output: { id: string; filename: string; delimiter: string; headers: string[]; mapping: string[]; source: string; sourceKind: "owner_csv" | "google" | "microsoft" | "vcard" | "csv" | "device"; signupFlow: "portal_account" | null; subjectContactId: string | null; allowedFields: string[]; status: "mapping" | "validated" | "committed" | "reverted" | "failed"; counts: unknown; error: string | null; committedAt: string | null; revertedAt: string | null; createdAt: string; [key: string]: unknown }[];
  };
  "contactImports.map": {
    input: { id: string; mapping: ("email" | "name" | "phone" | "country" | "preferredLocale" | "timezone" | "tags" | "source" | "custom" | "ignore")[]; source?: string };
    output: { id: string; filename: string; delimiter: string; headers: string[]; mapping: string[]; source: string; sourceKind: "owner_csv" | "google" | "microsoft" | "vcard" | "csv" | "device"; signupFlow: "portal_account" | null; subjectContactId: string | null; allowedFields: string[]; status: "mapping" | "validated" | "committed" | "reverted" | "failed"; counts: unknown; error: string | null; committedAt: string | null; revertedAt: string | null; createdAt: string; [key: string]: unknown };
  };
  "contactImports.revert": {
    input: { id: string };
    output: { id: string; restored: number; deleted: number; kept: number; [key: string]: unknown };
  };
  "contacts.addPrivacyRetentionException": {
    input: { dataRequestId: string; scope: string; reason: "legal_obligation" | "legal_claim" | "contractual_obligation" | "accounting_tax" | "security_fraud"; legalBasis: string; notes?: string | null; expiresAt?: string | null };
    output: { id: string; dataRequestId: string; scope: string; reason: "legal_obligation" | "legal_claim" | "contractual_obligation" | "accounting_tax" | "security_fraud"; legalBasis: string; notes: string | null; expiresAt: string | null; createdBy: string; createdAt: string; [key: string]: unknown };
  };
  "contacts.canContact": {
    input: { contactId: string; purpose: "marketing" | "analytics" | "data_processing"; channel: ("email" | "sms" | "push" | "web") | null };
    output: { allowed: boolean; reason: string; evidenceId: string | null; expiresAt: string | null };
  };
  "contacts.create": {
    input: { name: string; email?: string | null; phone?: string | null; orgId?: string | null; source?: string | null; tags?: string[]; customFields?: { [key: string]: unknown }; lifecycleStage?: "lead" | "prospect" | "customer" | "repeat"; preferredLocale?: string | null; timezone?: string | null; country?: string | null; ownerNotes?: string | null };
    output: { id: string; userId: string | null; name: string; email: string | null; phone: string | null; phoneStatus: "unknown" | "valid" | "invalid"; phoneInvalidAt: string | null; phoneInvalidReason: string | null; phoneInvalidProviderCode: string | null; orgId: string | null; source: string | null; tags: string[]; customFields: unknown; lifecycleStage: "lead" | "prospect" | "customer" | "repeat"; preferredLocale: string | null; timezone: string | null; country: string | null; ownerNotes: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "contacts.createCustomField": {
    input: { entity: "contact" | "organization"; key: string; label: string; kind: "text" | "number" | "boolean" | "date" | "select"; helpText?: string | null; options?: string[]; position?: number };
    output: { id: string; entity: "contact" | "organization"; key: string; label: string; kind: "text" | "number" | "boolean" | "date" | "select"; helpText: string | null; options: string[]; position: number; active: boolean; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "contacts.createDataRequest": {
    input: { contactId: string; jurisdiction?: string | null; request: { kind: "access"; note?: string } | { kind: "export"; note?: string } | { kind: "erasure"; note?: string } | { kind: "correction"; note?: string; changes: { name?: string; email?: string | null; phone?: string | null; preferredLocale?: string | null; timezone?: string | null; country?: string | null } } };
    output: { id: string; contactId: string; kind: "access" | "export" | "correction" | "erasure"; status: "submitted" | "verified" | "in_progress" | "completed" | "partially_completed" | "denied" | "cancelled"; jurisdiction: string | null; details: unknown; requestedBy: string; verificationMethod: string | null; verifiedAt: string | null; responseDueAt: string; resolution: string | null; fulfilledAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "contacts.createOrganization": {
    input: { name: string; domain?: string | null; customFields?: { [key: string]: unknown } };
    output: { id: string; name: string; domain: string | null; customFields: unknown; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "contacts.createRelationship": {
    input: { fromContactId: string; toContactId: string; kind: "household" | "employer" | "referred_by" | "partner" | "guardian" | "contact_book"; since?: string | null; notes?: string | null };
    output: { id: string; fromContactId: string; toContactId: string; kind: "household" | "employer" | "referred_by" | "partner" | "guardian" | "contact_book"; since: string | null; notes: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "contacts.deleteOrganization": {
    input: { id: string };
    output: { ok: true };
  };
  "contacts.deleteRelationship": {
    input: { id: string };
    output: { ok: true };
  };
  "contacts.denyDataRequest": {
    input: { id: string; resolution: string };
    output: { id: string; contactId: string; kind: "access" | "export" | "correction" | "erasure"; status: "submitted" | "verified" | "in_progress" | "completed" | "partially_completed" | "denied" | "cancelled"; jurisdiction: string | null; details: unknown; requestedBy: string; verificationMethod: string | null; verifiedAt: string | null; responseDueAt: string; resolution: string | null; fulfilledAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "contacts.dismissDuplicateCandidate": {
    input: { id: string };
    output: { id: string; contactAId: string | null; contactBId: string | null; contactAName: string; contactAEmail: string | null; contactBName: string; contactBEmail: string | null; score: number; reasons: unknown; status: "open" | "dismissed" | "merged"; detectedAt: string; dismissedAt: string | null; mergedAt: string | null; updatedAt: string; [key: string]: unknown };
  };
  "contacts.downloadDataRequestArtifact": {
    input: { id: string };
    output: { id: string; filename: string; mime: string; sha256: string; expiresAt: string; content: string };
  };
  "contacts.fulfillDataRequest": {
    input: { id: string; confirmation?: string };
    output: { request: { id: string; contactId: string; kind: "access" | "export" | "correction" | "erasure"; status: "submitted" | "verified" | "in_progress" | "completed" | "partially_completed" | "denied" | "cancelled"; jurisdiction: string | null; details: unknown; requestedBy: string; verificationMethod: string | null; verifiedAt: string | null; responseDueAt: string; resolution: string | null; fulfilledAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }; artifact: { id: string; dataRequestId: string; filename: string; mime: string; body: unknown; sha256: string; expiresAt: string; lastDownloadedAt: string | null; createdAt: string; [key: string]: unknown } };
  };
  "contacts.get": {
    input: { id: string };
    output: { id: string; userId: string | null; name: string; email: string | null; phone: string | null; phoneStatus: "unknown" | "valid" | "invalid"; phoneInvalidAt: string | null; phoneInvalidReason: string | null; phoneInvalidProviderCode: string | null; orgId: string | null; source: string | null; tags: string[]; customFields: unknown; lifecycleStage: "lead" | "prospect" | "customer" | "repeat"; preferredLocale: string | null; timezone: string | null; country: string | null; ownerNotes: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "contacts.getConsentPreferences": {
    input: { contactId: string };
    output: { effective: { purpose: "marketing" | "analytics" | "data_processing"; channel: ("email" | "sms" | "push" | "web") | null; state: "granted" | "denied" | "withdrawn" | "expired"; record: { id: string; contactId: string; purpose: "marketing" | "analytics" | "data_processing"; channel: ("email" | "sms" | "push" | "web") | null; state: "granted" | "denied" | "withdrawn"; method: "form" | "preference_center" | "double_opt_in" | "verbal" | "written" | "contract" | "import" | "system"; termsVersion: string | null; sourceUrl: string | null; ip: string | null; evidence: unknown; actor: string; occurredAt: string; expiresAt: string | null; createdAt: string; [key: string]: unknown } | null; [key: string]: unknown }[]; history: { id: string; contactId: string; purpose: "marketing" | "analytics" | "data_processing"; channel: ("email" | "sms" | "push" | "web") | null; state: "granted" | "denied" | "withdrawn"; method: "form" | "preference_center" | "double_opt_in" | "verbal" | "written" | "contract" | "import" | "system"; termsVersion: string | null; sourceUrl: string | null; ip: string | null; evidence: unknown; actor: string; occurredAt: string; expiresAt: string | null; createdAt: string; [key: string]: unknown }[]; contact: { id: string; userId: string | null; name: string; email: string | null; phone: string | null; orgId: string | null; source: string | null; tags: string[]; customFields: unknown; lifecycleStage: "lead" | "prospect" | "customer" | "repeat"; preferredLocale: string | null; timezone: string | null; country: string | null; ownerNotes: string | null; createdAt: string; updatedAt: string; [key: string]: unknown } };
  };
  "contacts.getDataRequest": {
    input: { id: string };
    output: { request: { id: string; contactId: string; kind: "access" | "export" | "correction" | "erasure"; status: "submitted" | "verified" | "in_progress" | "completed" | "partially_completed" | "denied" | "cancelled"; jurisdiction: string | null; details: unknown; requestedBy: string; verificationMethod: string | null; verifiedAt: string | null; responseDueAt: string; resolution: string | null; fulfilledAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }; exceptions: { id: string; dataRequestId: string; scope: string; reason: "legal_obligation" | "legal_claim" | "contractual_obligation" | "accounting_tax" | "security_fraud"; legalBasis: string; notes: string | null; expiresAt: string | null; createdBy: string; createdAt: string; [key: string]: unknown }[]; artifact: { id: string; filename: string; mime: string; sha256: string; expiresAt: string; createdAt: string; [key: string]: unknown } | null };
  };
  "contacts.getOrganization": {
    input: { id: string };
    output: { id: string; name: string; domain: string | null; customFields: unknown; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "contacts.list": {
    input: { search?: string; lifecycleStage?: "lead" | "prospect" | "customer" | "repeat"; tag?: string; organizationId?: string; limit?: number; offset?: number };
    output: { rows: { id: string; userId: string | null; name: string; email: string | null; phone: string | null; phoneStatus: "unknown" | "valid" | "invalid"; phoneInvalidAt: string | null; phoneInvalidReason: string | null; phoneInvalidProviderCode: string | null; orgId: string | null; source: string | null; tags: string[]; customFields: unknown; lifecycleStage: "lead" | "prospect" | "customer" | "repeat"; preferredLocale: string | null; timezone: string | null; country: string | null; ownerNotes: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[]; total: number };
  };
  "contacts.listCustomFields": {
    input: { entity?: "contact" | "organization"; includeInactive?: boolean };
    output: { id: string; entity: "contact" | "organization"; key: string; label: string; kind: "text" | "number" | "boolean" | "date" | "select"; helpText: string | null; options: string[]; position: number; active: boolean; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "contacts.listDataRequests": {
    input: { status?: "submitted" | "verified" | "in_progress" | "completed" | "partially_completed" | "denied" | "cancelled"; contactId?: string; limit?: number; offset?: number };
    output: { request: { id: string; contactId: string; kind: "access" | "export" | "correction" | "erasure"; status: "submitted" | "verified" | "in_progress" | "completed" | "partially_completed" | "denied" | "cancelled"; jurisdiction: string | null; details: unknown; requestedBy: string; verificationMethod: string | null; verifiedAt: string | null; responseDueAt: string; resolution: string | null; fulfilledAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }; contact: { id: string; userId: string | null; name: string; email: string | null; phone: string | null; orgId: string | null; source: string | null; tags: string[]; customFields: unknown; lifecycleStage: "lead" | "prospect" | "customer" | "repeat"; preferredLocale: string | null; timezone: string | null; country: string | null; ownerNotes: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }; [key: string]: unknown }[];
  };
  "contacts.listDuplicateCandidates": {
    input: { status?: "open" | "dismissed" | "merged"; limit?: number; offset?: number };
    output: { rows: { id: string; contactAId: string | null; contactBId: string | null; contactAName: string; contactAEmail: string | null; contactBName: string; contactBEmail: string | null; score: number; reasons: unknown; status: "open" | "dismissed" | "merged"; detectedAt: string; dismissedAt: string | null; mergedAt: string | null; updatedAt: string; [key: string]: unknown }[]; total: number };
  };
  "contacts.listMergeOperations": {
    input: { limit?: number };
    output: { id: string; candidateId: string | null; survivingContactId: string; duplicateContactId: string; survivorBefore: unknown; duplicateBefore: unknown; survivorAfter: unknown; referenceState: unknown; undoable: boolean; undoBlockers: string[]; mergedAt: string; undoneAt: string | null; [key: string]: unknown }[];
  };
  "contacts.listOrganizations": {
    input: { search?: string; limit?: number; offset?: number };
    output: { rows: ({ id: string; name: string; domain: string | null; customFields: unknown; createdAt: string; updatedAt: string; [key: string]: unknown } & { memberCount: number; [key: string]: unknown })[]; total: number };
  };
  "contacts.listRelationships": {
    input: { contactId: string };
    output: ({ id: string; fromContactId: string; toContactId: string; kind: "household" | "employer" | "referred_by" | "partner" | "guardian" | "contact_book"; since: string | null; notes: string | null; createdAt: string; updatedAt: string; [key: string]: unknown } & { direction: "peer" | "outgoing" | "incoming"; otherContact: { id: string; name: string; email: string | null; [key: string]: unknown }; [key: string]: unknown })[];
  };
  "contacts.listTags": {
    input: Record<string, never>;
    output: string[];
  };
  "contacts.merge": {
    input: { survivingId: string; duplicateId: string; candidateId?: string };
    output: { id: string; userId: string | null; name: string; email: string | null; phone: string | null; phoneStatus: "unknown" | "valid" | "invalid"; phoneInvalidAt: string | null; phoneInvalidReason: string | null; phoneInvalidProviderCode: string | null; orgId: string | null; source: string | null; tags: string[]; customFields: unknown; lifecycleStage: "lead" | "prospect" | "customer" | "repeat"; preferredLocale: string | null; timezone: string | null; country: string | null; ownerNotes: string | null; createdAt: string; updatedAt: string; [key: string]: unknown } & { mergeOperationId: string; [key: string]: unknown };
  };
  "contacts.mergeDuplicateCandidate": {
    input: { candidateId: string; survivingId: string; duplicateId: string };
    output: { id: string; userId: string | null; name: string; email: string | null; phone: string | null; phoneStatus: "unknown" | "valid" | "invalid"; phoneInvalidAt: string | null; phoneInvalidReason: string | null; phoneInvalidProviderCode: string | null; orgId: string | null; source: string | null; tags: string[]; customFields: unknown; lifecycleStage: "lead" | "prospect" | "customer" | "repeat"; preferredLocale: string | null; timezone: string | null; country: string | null; ownerNotes: string | null; createdAt: string; updatedAt: string; [key: string]: unknown } & { mergeOperationId: string; [key: string]: unknown };
  };
  "contacts.recordConsent": {
    input: { contactId: string; purpose: "marketing" | "analytics" | "data_processing"; channel?: ("email" | "sms" | "push" | "web") | null; state: "granted" | "denied" | "withdrawn"; method: "form" | "preference_center" | "double_opt_in" | "verbal" | "written" | "contract" | "import" | "system"; termsVersion?: string | null; sourceUrl?: string | null; sourceIp?: string | null; evidence?: { [key: string]: string | number | boolean | null }; occurredAt?: string; expiresAt?: string | null };
    output: { id: string; contactId: string; purpose: "marketing" | "analytics" | "data_processing"; channel: ("email" | "sms" | "push" | "web") | null; state: "granted" | "denied" | "withdrawn"; method: "form" | "preference_center" | "double_opt_in" | "verbal" | "written" | "contract" | "import" | "system"; termsVersion: string | null; sourceUrl: string | null; ip: string | null; evidence: unknown; actor: string; occurredAt: string; expiresAt: string | null; createdAt: string; [key: string]: unknown };
  };
  "contacts.removePrivacyRetentionException": {
    input: { id: string };
    output: { ok: true };
  };
  "contacts.resolve": {
    input: { name?: string; email: string; phone?: string | null; orgId?: string | null; source?: string | null; tags?: string[]; customFields?: { [key: string]: unknown }; lifecycleStage?: "lead" | "prospect" | "customer" | "repeat"; preferredLocale?: string | null; timezone?: string | null; country?: string | null; ownerNotes?: string | null };
    output: { contact: { id: string; userId: string | null; name: string; email: string | null; phone: string | null; phoneStatus: "unknown" | "valid" | "invalid"; phoneInvalidAt: string | null; phoneInvalidReason: string | null; phoneInvalidProviderCode: string | null; orgId: string | null; source: string | null; tags: string[]; customFields: unknown; lifecycleStage: "lead" | "prospect" | "customer" | "repeat"; preferredLocale: string | null; timezone: string | null; country: string | null; ownerNotes: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }; created: boolean; updated: boolean };
  };
  "contacts.scanDuplicates": {
    input: Record<string, never>;
    output: { scannedPairs: number; openCandidates: number };
  };
  "contacts.startDataRequest": {
    input: { id: string };
    output: { id: string; contactId: string; kind: "access" | "export" | "correction" | "erasure"; status: "submitted" | "verified" | "in_progress" | "completed" | "partially_completed" | "denied" | "cancelled"; jurisdiction: string | null; details: unknown; requestedBy: string; verificationMethod: string | null; verifiedAt: string | null; responseDueAt: string; resolution: string | null; fulfilledAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "contacts.stats": {
    input: Record<string, never>;
    output: { total: number; byStage: { lead: number; prospect: number; customer: number; repeat: number } };
  };
  "contacts.timeline": {
    input: { contactId: string; limit?: number };
    output: { id: string; contactId: string; actor: string; eventType: string; subjectType: string; subjectId: string | null; payload: unknown; occurredAt: string; [key: string]: unknown }[];
  };
  "contacts.undoMerge": {
    input: { operationId: string };
    output: { operationId: string; survivingContact: { id: string; userId: string | null; name: string; email: string | null; phone: string | null; phoneStatus: "unknown" | "valid" | "invalid"; phoneInvalidAt: string | null; phoneInvalidReason: string | null; phoneInvalidProviderCode: string | null; orgId: string | null; source: string | null; tags: string[]; customFields: unknown; lifecycleStage: "lead" | "prospect" | "customer" | "repeat"; preferredLocale: string | null; timezone: string | null; country: string | null; ownerNotes: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }; restoredContact: { id: string; userId: string | null; name: string; email: string | null; phone: string | null; phoneStatus: "unknown" | "valid" | "invalid"; phoneInvalidAt: string | null; phoneInvalidReason: string | null; phoneInvalidProviderCode: string | null; orgId: string | null; source: string | null; tags: string[]; customFields: unknown; lifecycleStage: "lead" | "prospect" | "customer" | "repeat"; preferredLocale: string | null; timezone: string | null; country: string | null; ownerNotes: string | null; createdAt: string; updatedAt: string; [key: string]: unknown } };
  };
  "contacts.update": {
    input: { name?: string; email?: string | null; phone?: string | null; orgId?: string | null; source?: string | null; tags?: string[]; customFields?: { [key: string]: unknown }; lifecycleStage?: "lead" | "prospect" | "customer" | "repeat"; preferredLocale?: string | null; timezone?: string | null; country?: string | null; ownerNotes?: string | null; id: string };
    output: { id: string; userId: string | null; name: string; email: string | null; phone: string | null; phoneStatus: "unknown" | "valid" | "invalid"; phoneInvalidAt: string | null; phoneInvalidReason: string | null; phoneInvalidProviderCode: string | null; orgId: string | null; source: string | null; tags: string[]; customFields: unknown; lifecycleStage: "lead" | "prospect" | "customer" | "repeat"; preferredLocale: string | null; timezone: string | null; country: string | null; ownerNotes: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "contacts.updateCustomField": {
    input: { id: string; label?: string; helpText?: string | null; options?: string[]; position?: number; active?: boolean };
    output: { id: string; entity: "contact" | "organization"; key: string; label: string; kind: "text" | "number" | "boolean" | "date" | "select"; helpText: string | null; options: string[]; position: number; active: boolean; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "contacts.updateOrganization": {
    input: { name?: string; domain?: string | null; customFields?: { [key: string]: unknown }; id: string };
    output: { id: string; name: string; domain: string | null; customFields: unknown; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "contacts.updateRelationship": {
    input: { id: string; kind?: "household" | "employer" | "referred_by" | "partner" | "guardian" | "contact_book"; fromContactId?: string; toContactId?: string; since?: string | null; notes?: string | null };
    output: { id: string; fromContactId: string; toContactId: string; kind: "household" | "employer" | "referred_by" | "partner" | "guardian" | "contact_book"; since: string | null; notes: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "contacts.verifyDataRequest": {
    input: { id: string; method: string };
    output: { id: string; contactId: string; kind: "access" | "export" | "correction" | "erasure"; status: "submitted" | "verified" | "in_progress" | "completed" | "partially_completed" | "denied" | "cancelled"; jurisdiction: string | null; details: unknown; requestedBy: string; verificationMethod: string | null; verifiedAt: string | null; responseDueAt: string; resolution: string | null; fulfilledAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "contracts.archiveTemplate": {
    input: { id: string };
    output: { id: string; [key: string]: unknown };
  };
  "contracts.byToken": {
    input: { token: string };
    output: { id: string; title: string; body: string; kind: "waiver" | "agreement"; status: "issued" | "signed" | "declined" | "void"; signedAt: string | null; signerName: string | null } | null;
  };
  "contracts.countersign": {
    input: { id: string; signerName: string };
    output: { id: string; countersignedAt: string; [key: string]: unknown };
  };
  "contracts.decline": {
    input: { token: string; reason?: string | null };
    output: { id: string };
  };
  "contracts.export": {
    input: { id: string };
    output: { filename: string; body: string };
  };
  "contracts.get": {
    input: { id: string };
    output: { id: string; contactId: string; subjectType: string; subjectId: string | null; kind: "waiver" | "agreement"; title: string; status: "issued" | "signed" | "declined" | "void"; bodyHash: string; issuedAt: string; signedAt: string | null; signerName: string | null; body: string; signerEmail: string | null; signerIp: string | null; signerUserAgent: string | null; signatureHash: string | null; bodyIntact: boolean; [key: string]: unknown } | null;
  };
  "contracts.issue": {
    input: { contactId: string; subjectType: string; subjectId?: string | null; kind?: "waiver" | "agreement"; title: string; body: string };
    output: { id: string; contactId: string; subjectType: string; subjectId: string | null; kind: "waiver" | "agreement"; title: string; status: "issued" | "signed" | "declined" | "void"; bodyHash: string; issuedAt: string; signedAt: string | null; signerName: string | null; [key: string]: unknown };
  };
  "contracts.issueFromTemplate": {
    input: { templateId: string; contactId: string; subjectType?: string; subjectId?: string | null; values?: { [key: string]: string } };
    output: { id: string; title: string; missing: string[]; [key: string]: unknown };
  };
  "contracts.list": {
    input: { contactId?: string; subjectType?: string; subjectId?: string; status?: "issued" | "signed" | "declined" | "void"; limit?: number };
    output: { id: string; contactId: string; subjectType: string; subjectId: string | null; kind: "waiver" | "agreement"; title: string; status: "issued" | "signed" | "declined" | "void"; bodyHash: string; issuedAt: string; signedAt: string | null; signerName: string | null; [key: string]: unknown }[];
  };
  "contracts.listTemplates": {
    input: { kind?: "waiver" | "agreement"; includeArchived?: boolean };
    output: { id: string; name: string; kind: "waiver" | "agreement"; version: number; title: string; body: string; variables: unknown; requiresCountersignature: boolean; archivedAt: string | null; [key: string]: unknown }[];
  };
  "contracts.previewTemplate": {
    input: { id: string; contactId?: string; values?: { [key: string]: string } };
    output: { title: string; body: string; missing: string[] };
  };
  "contracts.saveTemplate": {
    input: { name: string; kind?: "waiver" | "agreement"; title: string; body: string; variables?: { key: string; label: string; fallback: string | null }[]; requiresCountersignature?: boolean };
    output: { id: string; name: string; kind: "waiver" | "agreement"; version: number; title: string; body: string; variables: unknown; requiresCountersignature: boolean; archivedAt: string | null; undeclared: string[]; [key: string]: unknown };
  };
  "contracts.sign": {
    input: { token: string; signerName: string; ip?: string | null; userAgent?: string | null };
    output: { id: string; signedAt: string; signatureHash: string };
  };
  "contracts.signedFor": {
    input: { subjectType: string; subjectId: string; kind?: "waiver" | "agreement" };
    output: { signed: boolean };
  };
  "contracts.signingLink": {
    input: { subjectType: string; subjectId: string };
    output: { token: string | null };
  };
  "contracts.void": {
    input: { id: string };
    output: { id: string };
  };
  "contribute.attach": {
    input: { id: string; assetId: string; role?: "screenshot" | "diff" | "archive" | "other" };
    output: { id: string; contributionId: string; assetId: string; role: "screenshot" | "diff" | "archive" | "other"; createdAt: string; [key: string]: unknown } | { id: string; attached: false };
  };
  "contribute.determine": {
    input: { id: string; status: "triage" | "needs_info" | "accepted" | "duplicate" | "wontfix" | "shipped"; note?: string; checklistId?: string; parentId?: string };
    output: { id: string; contactId: string | null; kind: "bug" | "feature" | "patch" | "docs" | "question"; status: "draft" | "queued" | "delivered" | "received" | "triage" | "needs_info" | "accepted" | "duplicate" | "wontfix" | "shipped"; title: string; body: string; locale: string; source: "admin" | "mcp" | "http" | "public_form" | "spoke"; reporterEmail: string | null; reporterName: string | null; externalUrl: string | null; hubReceiptId: string | null; contentHash: string; includeDoctor: boolean; doctorReport: unknown | null; platformVersion: string | null; dcoAttested: boolean; dcoSigner: string | null; checklistId: string | null; parentId: string | null; actor: string; createdAt: string; updatedAt: string };
  };
  "contribute.draft": {
    input: { kind: ("bug" | "feature" | "patch" | "docs" | "question") | "security"; title: string; body: string; locale?: string; email?: string; name?: string; externalUrl?: string; includeDoctor?: boolean; doctorReport?: unknown; dcoAttested?: boolean; dcoSigner?: string };
    output: { id: string; contactId: string | null; kind: "bug" | "feature" | "patch" | "docs" | "question"; status: "draft" | "queued" | "delivered" | "received" | "triage" | "needs_info" | "accepted" | "duplicate" | "wontfix" | "shipped"; title: string; body: string; locale: string; source: "admin" | "mcp" | "http" | "public_form" | "spoke"; reporterEmail: string | null; reporterName: string | null; externalUrl: string | null; hubReceiptId: string | null; contentHash: string; includeDoctor: boolean; doctorReport: unknown | null; platformVersion: string | null; dcoAttested: boolean; dcoSigner: string | null; checklistId: string | null; parentId: string | null; actor: string; createdAt: string; updatedAt: string };
  };
  "contribute.get": {
    input: { id: string };
    output: { id: string; contactId: string | null; kind: "bug" | "feature" | "patch" | "docs" | "question"; status: "draft" | "queued" | "delivered" | "received" | "triage" | "needs_info" | "accepted" | "duplicate" | "wontfix" | "shipped"; title: string; body: string; locale: string; source: "admin" | "mcp" | "http" | "public_form" | "spoke"; reporterEmail: string | null; reporterName: string | null; externalUrl: string | null; hubReceiptId: string | null; contentHash: string; includeDoctor: boolean; doctorReport: unknown | null; platformVersion: string | null; dcoAttested: boolean; dcoSigner: string | null; checklistId: string | null; parentId: string | null; actor: string; createdAt: string; updatedAt: string; events: { id: string; kind: string; body: string | null; actor: string; createdAt: string; [key: string]: unknown }[]; assets: { id: string; assetId: string; role: "screenshot" | "diff" | "archive" | "other"; [key: string]: unknown }[] };
  };
  "contribute.getSettings": {
    input: Record<string, never>;
    output: { hubEnabled: boolean; hubUrl: string; hasReceiveSecret: boolean; receiveSecret?: string };
  };
  "contribute.hubStatus": {
    input: Record<string, never>;
    output: { hubEnabled: boolean };
  };
  "contribute.ingest": {
    input: { kind: ("bug" | "feature" | "patch" | "docs" | "question") | "security"; title: string; body: string; locale?: string; email?: string; name?: string; externalUrl?: string; includeDoctor?: boolean; doctorReport?: unknown; dcoAttested?: boolean; dcoSigner?: string; source?: "public_form" | "spoke" | "http" | "mcp"; contentHash?: string; signature?: string; platformVersion?: string; spokeId?: string; replyUrl?: string; replyToken?: string };
    output: { id: string; contactId: string | null; kind: "bug" | "feature" | "patch" | "docs" | "question"; status: "draft" | "queued" | "delivered" | "received" | "triage" | "needs_info" | "accepted" | "duplicate" | "wontfix" | "shipped"; title: string; body: string; locale: string; source: "admin" | "mcp" | "http" | "public_form" | "spoke"; reporterEmail: string | null; reporterName: string | null; externalUrl: string | null; hubReceiptId: string | null; contentHash: string; includeDoctor: boolean; doctorReport: unknown | null; platformVersion: string | null; dcoAttested: boolean; dcoSigner: string | null; checklistId: string | null; parentId: string | null; actor: string; createdAt: string; updatedAt: string };
  };
  "contribute.list": {
    input: { status?: "draft" | "queued" | "delivered" | "received" | "triage" | "needs_info" | "accepted" | "duplicate" | "wontfix" | "shipped"; kind?: "bug" | "feature" | "patch" | "docs" | "question"; limit?: number };
    output: { id: string; contactId: string | null; kind: "bug" | "feature" | "patch" | "docs" | "question"; status: "draft" | "queued" | "delivered" | "received" | "triage" | "needs_info" | "accepted" | "duplicate" | "wontfix" | "shipped"; title: string; body: string; locale: string; source: "admin" | "mcp" | "http" | "public_form" | "spoke"; reporterEmail: string | null; reporterName: string | null; externalUrl: string | null; hubReceiptId: string | null; contentHash: string; includeDoctor: boolean; doctorReport: unknown | null; platformVersion: string | null; dcoAttested: boolean; dcoSigner: string | null; checklistId: string | null; parentId: string | null; actor: string; createdAt: string; updatedAt: string }[];
  };
  "contribute.recordStatus": {
    input: { spokeId: string; replyToken: string; status: "received" | "triage" | "needs_info" | "accepted" | "duplicate" | "wontfix" | "shipped"; note?: string; checklistId?: string; hubId?: string };
    output: { id: string; contactId: string | null; kind: "bug" | "feature" | "patch" | "docs" | "question"; status: "draft" | "queued" | "delivered" | "received" | "triage" | "needs_info" | "accepted" | "duplicate" | "wontfix" | "shipped"; title: string; body: string; locale: string; source: "admin" | "mcp" | "http" | "public_form" | "spoke"; reporterEmail: string | null; reporterName: string | null; externalUrl: string | null; hubReceiptId: string | null; contentHash: string; includeDoctor: boolean; doctorReport: unknown | null; platformVersion: string | null; dcoAttested: boolean; dcoSigner: string | null; checklistId: string | null; parentId: string | null; actor: string; createdAt: string; updatedAt: string };
  };
  "contribute.setHubEnabled": {
    input: { enabled: boolean };
    output: { hubEnabled: boolean; hubUrl: string; hasReceiveSecret: boolean; receiveSecret?: string };
  };
  "contribute.submit": {
    input: { kind: ("bug" | "feature" | "patch" | "docs" | "question") | "security"; title: string; body: string; locale?: string; email?: string; name?: string; externalUrl?: string; includeDoctor?: boolean; doctorReport?: unknown; dcoAttested?: boolean; dcoSigner?: string; id?: string };
    output: { id: string; contactId: string | null; kind: "bug" | "feature" | "patch" | "docs" | "question"; status: "draft" | "queued" | "delivered" | "received" | "triage" | "needs_info" | "accepted" | "duplicate" | "wontfix" | "shipped"; title: string; body: string; locale: string; source: "admin" | "mcp" | "http" | "public_form" | "spoke"; reporterEmail: string | null; reporterName: string | null; externalUrl: string | null; hubReceiptId: string | null; contentHash: string; includeDoctor: boolean; doctorReport: unknown | null; platformVersion: string | null; dcoAttested: boolean; dcoSigner: string | null; checklistId: string | null; parentId: string | null; actor: string; createdAt: string; updatedAt: string };
  };
  "contribute.triage": {
    input: { id: string; note?: string };
    output: { id: string; contactId: string | null; kind: "bug" | "feature" | "patch" | "docs" | "question"; status: "draft" | "queued" | "delivered" | "received" | "triage" | "needs_info" | "accepted" | "duplicate" | "wontfix" | "shipped"; title: string; body: string; locale: string; source: "admin" | "mcp" | "http" | "public_form" | "spoke"; reporterEmail: string | null; reporterName: string | null; externalUrl: string | null; hubReceiptId: string | null; contentHash: string; includeDoctor: boolean; doctorReport: unknown | null; platformVersion: string | null; dcoAttested: boolean; dcoSigner: string | null; checklistId: string | null; parentId: string | null; actor: string; createdAt: string; updatedAt: string };
  };
  "contribute.updateSettings": {
    input: { hubEnabled?: boolean; hubUrl?: string; rotateReceiveSecret?: boolean; clearReceiveSecret?: boolean };
    output: { hubEnabled: boolean; hubUrl: string; hasReceiveSecret: boolean; receiveSecret?: string };
  };
  "conversations.assign": {
    input: { id: string; userId?: string | null };
    output: { id: string; contactId: string; subject: string | null; replyChannel: "form" | "email" | "sms" | "mms" | "chat" | "assistant" | "social"; status: "open" | "snoozed" | "closed"; snoozedUntil: string | null; assigneeUserId: string | null; unread: boolean; assistantEscalatedAt: string | null; assistantEscalationReason: string | null; assistantEscalationResolvedAt: string | null; messageCount: number; lastInboundAt: string | null; lastOutboundAt: string | null; updatedAt: string; [key: string]: unknown };
  };
  "conversations.bulk": {
    input: { ids: string[]; action: "assign" | "close" | "reopen" | "markRead" | "markUnread" | "snooze"; userId?: string | null; until?: string };
    output: { affected: number; [key: string]: unknown };
  };
  "conversations.counts": {
    input: Record<string, never>;
    output: { open: number; unread: number; unassigned: number; mine: number; [key: string]: unknown };
  };
  "conversations.get": {
    input: { id: string; limit?: number };
    output: { id: string; contactId: string; subject: string | null; replyChannel: "form" | "email" | "sms" | "mms" | "chat" | "assistant" | "social"; numberId: string | null; status: "open" | "snoozed" | "closed"; snoozedUntil: string | null; assigneeUserId: string | null; threadKey: string | null; lastInboundAt: string | null; lastOutboundAt: string | null; unread: boolean; assistantEscalatedAt: string | null; assistantEscalationReason: string | null; assistantEscalationResolvedAt: string | null; messageCount: number; updatedAt: string; contactName: string | null; messages: { id: string; conversationId: string; contactId: string; direction: "inbound" | "outbound"; channel: "form" | "email" | "sms" | "mms" | "chat" | "assistant" | "social"; purpose: ("transactional" | "marketing" | "support") | null; policyException: ("security_code" | "booking_update" | "order_update" | "customer_requested_reply") | null; policyExceptionRef: string | null; body: string; mediaAssetIds: string[]; chatSessionId: string | null; templateId: string | null; sentBy: "contact" | "user" | "system" | "automation" | "agent"; sentByUserId: string | null; providerRef: string | null; recipientAddress: string | null; segments: number | null; costMinor: number | null; costCurrency: string | null; occurredAt: string; deliveries: { status: "queued" | "sent" | "delivered" | "failed" | "undelivered" | "read"; errorCode: string | null; errorText: string | null; occurredAt: string; [key: string]: unknown }[]; [key: string]: unknown }[]; [key: string]: unknown } | null;
  };
  "conversations.list": {
    input: { status?: "open" | "snoozed" | "closed"; contactId?: string; channel?: "form" | "email" | "sms" | "mms" | "chat" | "assistant" | "social"; unreadOnly?: boolean; limit?: number };
    output: { id: string; contactId: string; subject: string | null; replyChannel: "form" | "email" | "sms" | "mms" | "chat" | "assistant" | "social"; numberId: string | null; status: "open" | "snoozed" | "closed"; snoozedUntil: string | null; assigneeUserId: string | null; threadKey: string | null; lastInboundAt: string | null; lastOutboundAt: string | null; unread: boolean; assistantEscalatedAt: string | null; assistantEscalationReason: string | null; assistantEscalationResolvedAt: string | null; messageCount: number; updatedAt: string; contactName: string | null; contactEmail: string | null; [key: string]: unknown }[];
  };
  "conversations.markRead": {
    input: { id: string; read?: boolean };
    output: { id: string; contactId: string; subject: string | null; replyChannel: "form" | "email" | "sms" | "mms" | "chat" | "assistant" | "social"; numberId: string | null; status: "open" | "snoozed" | "closed"; snoozedUntil: string | null; assigneeUserId: string | null; threadKey: string | null; lastInboundAt: string | null; lastOutboundAt: string | null; unread: boolean; assistantEscalatedAt: string | null; assistantEscalationReason: string | null; assistantEscalationResolvedAt: string | null; messageCount: number; updatedAt: string; [key: string]: unknown };
  };
  "conversations.record": {
    input: { contactId?: string; email?: string; phone?: string; name?: string; direction: "inbound" | "outbound"; channel: "form" | "email" | "sms" | "mms" | "chat" | "assistant" | "social"; purpose?: "transactional" | "marketing" | "support"; policyException?: "security_code" | "booking_update" | "order_update" | "customer_requested_reply"; policyExceptionRef?: string; body: string; subject?: string; mediaAssetIds?: string[]; chatSessionId?: string; templateId?: string; sentBy?: "contact" | "user" | "system" | "automation" | "agent"; sentByUserId?: string; providerRef?: string; recipientAddress?: string; threadKey?: string; conversationId?: string; numberId?: string; segments?: number; costMinor?: number; costCurrency?: string; occurredAt?: string };
    output: { conversation: { id: string; contactId: string; subject: string | null; replyChannel: "form" | "email" | "sms" | "mms" | "chat" | "assistant" | "social"; numberId: string | null; status: "open" | "snoozed" | "closed"; snoozedUntil: string | null; assigneeUserId: string | null; threadKey: string | null; lastInboundAt: string | null; lastOutboundAt: string | null; unread: boolean; assistantEscalatedAt: string | null; assistantEscalationReason: string | null; assistantEscalationResolvedAt: string | null; messageCount: number; updatedAt: string; [key: string]: unknown }; message: { id: string; conversationId: string; contactId: string; direction: "inbound" | "outbound"; channel: "form" | "email" | "sms" | "mms" | "chat" | "assistant" | "social"; purpose: ("transactional" | "marketing" | "support") | null; policyException: ("security_code" | "booking_update" | "order_update" | "customer_requested_reply") | null; policyExceptionRef: string | null; body: string; mediaAssetIds: string[]; chatSessionId: string | null; templateId: string | null; sentBy: "contact" | "user" | "system" | "automation" | "agent"; sentByUserId: string | null; providerRef: string | null; recipientAddress: string | null; segments: number | null; costMinor: number | null; costCurrency: string | null; occurredAt: string; [key: string]: unknown }; duplicate: boolean; [key: string]: unknown };
  };
  "conversations.recordDelivery": {
    input: { messageId: string; status: "queued" | "sent" | "delivered" | "failed" | "undelivered" | "read"; errorCode?: string | null; errorText?: string | null; occurredAt?: string };
    output: { id: string; duplicate: boolean; [key: string]: unknown };
  };
  "conversations.reply": {
    input: { id: string; body: string; close?: boolean };
    output: { id: string; channel: "form" | "email" | "sms" | "mms" | "chat" | "assistant" | "social"; [key: string]: unknown };
  };
  "conversations.search": {
    input: { status?: "open" | "snoozed" | "closed"; openOnly?: boolean; assigneeUserId?: string; unassigned?: boolean; channel?: "form" | "email" | "sms" | "mms" | "chat" | "assistant" | "social"; unreadOnly?: boolean; q?: string; limit?: number };
    output: { id: string; contactId: string; subject: string | null; replyChannel: "form" | "email" | "sms" | "mms" | "chat" | "assistant" | "social"; status: "open" | "snoozed" | "closed"; snoozedUntil: string | null; assigneeUserId: string | null; unread: boolean; assistantEscalatedAt: string | null; assistantEscalationReason: string | null; assistantEscalationResolvedAt: string | null; messageCount: number; lastInboundAt: string | null; lastOutboundAt: string | null; updatedAt: string; contactName: string | null; contactEmail: string | null; assigneeEmail: string | null; preview: string | null; [key: string]: unknown }[];
  };
  "conversations.setStatus": {
    input: { id: string; status: "open" | "closed" };
    output: { id: string; contactId: string; subject: string | null; replyChannel: "form" | "email" | "sms" | "mms" | "chat" | "assistant" | "social"; status: "open" | "snoozed" | "closed"; snoozedUntil: string | null; assigneeUserId: string | null; unread: boolean; assistantEscalatedAt: string | null; assistantEscalationReason: string | null; assistantEscalationResolvedAt: string | null; messageCount: number; lastInboundAt: string | null; lastOutboundAt: string | null; updatedAt: string; [key: string]: unknown };
  };
  "conversations.snooze": {
    input: { id: string; until: string };
    output: { id: string; contactId: string; subject: string | null; replyChannel: "form" | "email" | "sms" | "mms" | "chat" | "assistant" | "social"; status: "open" | "snoozed" | "closed"; snoozedUntil: string | null; assigneeUserId: string | null; unread: boolean; assistantEscalatedAt: string | null; assistantEscalationReason: string | null; assistantEscalationResolvedAt: string | null; messageCount: number; lastInboundAt: string | null; lastOutboundAt: string | null; updatedAt: string; [key: string]: unknown };
  };
  "core.loadDemoBookings": {
    input: { scenarioKey: string; scenarioVersion: number; runId: string; generation: number; locale: string; records?: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
    output: { records: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
  };
  "core.loadDemoContacts": {
    input: { scenarioKey: string; scenarioVersion: number; runId: string; generation: number; locale: string; records?: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
    output: { records: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
  };
  "core.loadDemoInbox": {
    input: { scenarioKey: string; scenarioVersion: number; runId: string; generation: number; locale: string; records?: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
    output: { records: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
  };
  "core.loadDemoLocations": {
    input: { scenarioKey: string; scenarioVersion: number; runId: string; generation: number; locale: string; records?: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
    output: { records: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
  };
  "core.purgeDemoBookings": {
    input: { scenarioKey: string; scenarioVersion: number; runId: string; generation: number; locale: string; records?: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
    output: { purged: { subjectType: string; subjectId: string }[] };
  };
  "core.purgeDemoContacts": {
    input: { scenarioKey: string; scenarioVersion: number; runId: string; generation: number; locale: string; records?: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
    output: { purged: { subjectType: string; subjectId: string }[] };
  };
  "core.purgeDemoInbox": {
    input: { scenarioKey: string; scenarioVersion: number; runId: string; generation: number; locale: string; records?: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
    output: { purged: { subjectType: string; subjectId: string }[] };
  };
  "core.purgeDemoLocations": {
    input: { scenarioKey: string; scenarioVersion: number; runId: string; generation: number; locale: string; records?: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
    output: { purged: { subjectType: string; subjectId: string }[] };
  };
  "core.verifyDemoBookings": {
    input: { scenarioKey: string; scenarioVersion: number; runId: string; generation: number; locale: string; records?: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
    output: { outcomes: { key: string; achieved: boolean; detail?: string }[] };
  };
  "core.verifyDemoContacts": {
    input: { scenarioKey: string; scenarioVersion: number; runId: string; generation: number; locale: string; records?: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
    output: { outcomes: { key: string; achieved: boolean; detail?: string }[] };
  };
  "core.verifyDemoInbox": {
    input: { scenarioKey: string; scenarioVersion: number; runId: string; generation: number; locale: string; records?: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
    output: { outcomes: { key: string; achieved: boolean; detail?: string }[] };
  };
  "core.verifyDemoLocations": {
    input: { scenarioKey: string; scenarioVersion: number; runId: string; generation: number; locale: string; records?: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
    output: { outcomes: { key: string; achieved: boolean; detail?: string }[] };
  };
  "crm.createDeal": {
    input: { contactId: string; title: string; pipelineId?: string; stageId?: string; valueMinor?: number; currency?: string | null; expectedCloseOn?: string | null; source?: string | null; ownerUserId?: string | null; quoteId?: string | null };
    output: { id: string; contactId: string; pipelineId: string; stageId: string; title: string; valueMinor: number; currency: string | null; probability: number | null; expectedCloseOn: string | null; source: string | null; ownerUserId: string | null; quoteId: string | null; status: "open" | "won" | "lost"; lostReason: string | null; closedAt: string | null; [key: string]: unknown };
  };
  "crm.installDefaults": {
    input: Record<string, never>;
    output: { pipelines: number; stages: number; [key: string]: unknown };
  };
  "crm.lifecycleBoard": {
    input: { pipelineId?: string; limit?: number };
    output: { contactId: string; contactName: string; stageId: string; stageName: string; enteredAt: string; [key: string]: unknown }[];
  };
  "crm.listDeals": {
    input: { pipelineId?: string; status?: "open" | "won" | "lost"; ownerUserId?: string; limit?: number };
    output: { id: string; contactId: string; pipelineId: string; stageId: string; title: string; valueMinor: number; currency: string | null; probability: number | null; expectedCloseOn: string | null; source: string | null; ownerUserId: string | null; quoteId: string | null; status: "open" | "won" | "lost"; lostReason: string | null; closedAt: string | null; contactName: string | null; stageName: string; effectiveProbability: number; weightedMinor: number; [key: string]: unknown }[];
  };
  "crm.listPipelines": {
    input: { kind?: "lifecycle" | "deal"; includeArchived?: boolean };
    output: { id: string; kind: "lifecycle" | "deal"; name: string; isDefault: boolean; position: number; archivedAt: string | null; stages: { id: string; pipelineId: string; name: string; position: number; tone: string | null; probability: number | null; isWon: boolean; isLost: boolean; lifecycleStage: ("lead" | "prospect" | "customer" | "repeat") | null; [key: string]: unknown }[]; [key: string]: unknown }[];
  };
  "crm.moveContactStage": {
    input: { contactId: string; stageId: string };
    output: { contactId: string; stageId: string; lifecycleStage: string; [key: string]: unknown };
  };
  "crm.moveDeal": {
    input: { id: string; stageId: string; lostReason?: string | null };
    output: { id: string; contactId: string; pipelineId: string; stageId: string; title: string; valueMinor: number; currency: string | null; probability: number | null; expectedCloseOn: string | null; source: string | null; ownerUserId: string | null; quoteId: string | null; status: "open" | "won" | "lost"; lostReason: string | null; closedAt: string | null; [key: string]: unknown };
  };
  "crm.removeStage": {
    input: { id: string };
    output: { id: string; [key: string]: unknown };
  };
  "crm.savePipeline": {
    input: { id?: string; kind: "lifecycle" | "deal"; name: string; isDefault?: boolean };
    output: { id: string; kind: "lifecycle" | "deal"; name: string; isDefault: boolean; position: number; archivedAt: string | null; [key: string]: unknown };
  };
  "crm.saveStage": {
    input: { id?: string; pipelineId: string; name: string; position?: number; tone?: string | null; probability?: number | null; isWon?: boolean; isLost?: boolean; lifecycleStage?: ("lead" | "prospect" | "customer" | "repeat") | null };
    output: { id: string; pipelineId: string; name: string; position: number; tone: string | null; probability: number | null; isWon: boolean; isLost: boolean; lifecycleStage: ("lead" | "prospect" | "customer" | "repeat") | null; [key: string]: unknown };
  };
  "crm.updateDeal": {
    input: { id: string; title?: string; valueMinor?: number; probability?: number | null; expectedCloseOn?: string | null; ownerUserId?: string | null };
    output: { id: string; contactId: string; pipelineId: string; stageId: string; title: string; valueMinor: number; currency: string | null; probability: number | null; expectedCloseOn: string | null; source: string | null; ownerUserId: string | null; quoteId: string | null; status: "open" | "won" | "lost"; lostReason: string | null; closedAt: string | null; [key: string]: unknown };
  };
  "demo.install": {
    input: { publish?: boolean };
    output: { business: string; pages: string[]; assets: number };
  };
  "demo.list": {
    input: Record<string, never>;
    output: { key: string; version: number; titleKey: string; descriptionKey: string; preset: string; requiredModules: string[]; requiredCapabilities: string[]; fixtureManifest: unknown; defaultLocale: string; supportedLocales: string[]; tourFlowKey: string | null; status: "draft" | "active" | "retired"; createdAt: string; updatedAt: string; activeRun: { id: string; scenarioKey: string; scenarioVersion: number; locale: string; generation: number; status: "active" | "purged"; loadedAt: string; purgedAt: string | null; updatedAt: string; [key: string]: unknown } | null; [key: string]: unknown }[];
  };
  "demo.load": {
    input: { key: string; version?: number; locale?: string };
    output: { action: "unchanged" | "loaded"; run: { id: string; scenarioKey: string; scenarioVersion: number; locale: string; generation: number; status: "active" | "purged"; loadedAt: string; purgedAt: string | null; updatedAt: string; [key: string]: unknown } };
  };
  "demo.purge": {
    input: Record<string, never>;
    output: { action: "unchanged" | "purged"; run: { id: string; scenarioKey: string; scenarioVersion: number; locale: string; generation: number; status: "active" | "purged"; loadedAt: string; purgedAt: string | null; updatedAt: string; [key: string]: unknown } | null };
  };
  "demo.reload": {
    input: Record<string, never>;
    output: { action: "reloaded"; run: { id: string; scenarioKey: string; scenarioVersion: number; locale: string; generation: number; status: "active" | "purged"; loadedAt: string; purgedAt: string | null; updatedAt: string; [key: string]: unknown } };
  };
  "demo.reset": {
    input: { key: string; version?: number; locale?: string };
    output: { action: "reset"; run: { id: string; scenarioKey: string; scenarioVersion: number; locale: string; generation: number; status: "active" | "purged"; loadedAt: string; purgedAt: string | null; updatedAt: string; [key: string]: unknown } };
  };
  "documents.addVersion": {
    input: { documentId: string; assetId: string; note?: string | null };
    output: { id: string; documentId: string; version: number; assetId: string; note: string | null; createdAt: string; [key: string]: unknown };
  };
  "documents.export": {
    input: { documentId: string };
    output: { document: { id: string; title: string; description: string | null; subjectType: string | null; subjectId: string | null; contactId: string | null; currentVersionId: string | null; status: "draft" | "shared" | "archived"; updatedAt: string; [key: string]: unknown }; versions: { id: string; documentId: string; version: number; assetId: string; note: string | null; createdAt: string; [key: string]: unknown }[]; shares: { id: string; documentId: string; contactId: string | null; access: "link" | "password" | "login"; pinnedVersionId: string | null; downloadPolicy: "none" | "view" | "download"; downloadLimit: number | null; expiresAt: string | null; revokedAt: string | null; [key: string]: unknown }[]; access: { action: "view" | "download" | "denied"; reason: string | null; contactId: string | null; at: string; [key: string]: unknown }[]; [key: string]: unknown };
  };
  "documents.history": {
    input: { documentId: string; limit?: number };
    output: { id: string; versionId: string | null; shareId: string | null; contactId: string | null; action: "view" | "download" | "denied"; reason: string | null; at: string; [key: string]: unknown }[];
  };
  "documents.list": {
    input: { contactId?: string; subjectType?: string; subjectId?: string; status?: "draft" | "shared" | "archived"; limit?: number };
    output: { id: string; title: string; description: string | null; subjectType: string | null; subjectId: string | null; contactId: string | null; currentVersionId: string | null; status: "draft" | "shared" | "archived"; updatedAt: string; [key: string]: unknown }[];
  };
  "documents.open": {
    input: { token: string; password?: string; action?: "view" | "download" };
    output: { ok: true; documentId: string; title: string; version: number; assetId: string; filename: string; mime: string; downloadPolicy: "none" | "view" | "download"; [key: string]: unknown } | { ok: false };
  };
  "documents.revokeShare": {
    input: { shareId: string };
    output: { shareId: string; revokedAt: string; [key: string]: unknown };
  };
  "documents.save": {
    input: { id?: string; title: string; description?: string | null; subjectType?: string | null; subjectId?: string | null; contactId?: string | null; status?: "draft" | "shared" | "archived" };
    output: { id: string; title: string; description: string | null; subjectType: string | null; subjectId: string | null; contactId: string | null; currentVersionId: string | null; status: "draft" | "shared" | "archived"; updatedAt: string; [key: string]: unknown };
  };
  "documents.share": {
    input: { documentId: string; contactId?: string | null; access: "link" | "password" | "login"; password?: string; pinnedVersionId?: string | null; downloadPolicy?: "none" | "view" | "download"; downloadLimit?: number | null; expiresAt?: string | null };
    output: { shareId: string; token: string | null; [key: string]: unknown };
  };
  "documents.shares": {
    input: { documentId: string };
    output: { id: string; documentId: string; contactId: string | null; access: "link" | "password" | "login"; pinnedVersionId: string | null; downloadPolicy: "none" | "view" | "download"; downloadLimit: number | null; expiresAt: string | null; revokedAt: string | null; [key: string]: unknown }[];
  };
  "documents.versions": {
    input: { documentId: string };
    output: { id: string; documentId: string; version: number; assetId: string; note: string | null; createdAt: string; [key: string]: unknown }[];
  };
  "entitlements.grant": {
    input: { contactId: string; entitlementId?: string; grantorType?: "plan" | "pass" | "unlock" | "tier" | "manual"; grantorId?: string; name?: string; resource?: { kind: string; selector?: string }; startsAt?: string; endsAt?: string | null };
    output: { id: string; contactId: string; entitlementId: string; sourceSubscriptionId: string | null; sourcePassBalanceId: string | null; sourceUnlockId: string | null; startsAt: string; endsAt: string | null; used: number; status: "active" | "paused" | "expired" | "revoked"; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "entitlements.hasAccess": {
    input: { resource: { kind: string; selector?: string }; contactId?: string };
    output: { allowed: boolean; contactId: string | null; [key: string]: unknown };
  };
  "entitlements.list": {
    input: { grantorType?: "plan" | "pass" | "unlock" | "tier" | "manual"; grantorId?: string; limit?: number };
    output: { id: string; grantorType: "plan" | "pass" | "unlock" | "tier" | "manual"; grantorId: string; name: string; resource: { kind: string; selector?: string }; quantity: number | null; period: "per_month" | "per_cycle" | "total"; priority: number; status: "active" | "archived"; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "entitlements.listGrants": {
    input: { contactId?: string; status?: "active" | "paused" | "expired" | "revoked"; limit?: number };
    output: { id: string; contactId: string; entitlementId: string; sourceSubscriptionId: string | null; sourcePassBalanceId: string | null; sourceUnlockId: string | null; startsAt: string; endsAt: string | null; used: number; status: "active" | "paused" | "expired" | "revoked"; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "entitlements.revoke": {
    input: { id: string };
    output: { ok: true };
  };
  "entitlements.save": {
    input: { id?: string; grantorType: "plan" | "pass" | "unlock" | "tier" | "manual"; grantorId: string; name: string; resource: { kind: string; selector?: string }; quantity?: number | null; period?: "per_month" | "per_cycle" | "total"; priority?: number; status?: "active" | "archived" };
    output: { id: string; grantorType: "plan" | "pass" | "unlock" | "tier" | "manual"; grantorId: string; name: string; resource: { kind: string; selector?: string }; quantity: number | null; period: "per_month" | "per_cycle" | "total"; priority: number; status: "active" | "archived"; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "entitlements.spendPass": {
    input: { passBalanceId: string; contactId: string };
    output: { remaining: number; [key: string]: unknown };
  };
  "events.addSession": {
    input: { eventId: string; startsAt: string; endsAt: string; timezone?: string; capacity: number; waitlistEnabled?: boolean };
    output: { id: string; eventId: string; startsAt: string; endsAt: string; timezone: string; capacity: number; waitlistEnabled: boolean; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "events.addTicket": {
    input: { eventId: string; name: string; priceMinor: number; currency?: string };
    output: { id: string; eventId: string; name: string; priceMinor: number; currency: string; active: boolean; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "events.calendar": {
    input: { slug: string };
    output: string | null;
  };
  "events.cancel": {
    input: { id: string; expectedVersion: number };
    output: { id: string; name: string; slug: string; summary: string | null; venueName: string | null; venueAddress: string | null; venueLocationId: string | null; status: "draft" | "published" | "cancelled"; seo: unknown; workingName: string | null; workingSummary: string | null; workingVenueName: string | null; workingVenueAddress: string | null; workingSeo: unknown | null; version: number; publishedAt: string | null; cancelledAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "events.cancelRegistration": {
    input: { id: string };
    output: { id: string; eventId: string; sessionId: string; ticketId: string | null; contactId: string; status: "reserved" | "confirmed" | "waitlisted" | "cancelled" | "checked_in"; quantity: number; checkedInAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "events.checkIn": {
    input: { id: string };
    output: { id: string; eventId: string; sessionId: string; ticketId: string | null; contactId: string; status: "reserved" | "confirmed" | "waitlisted" | "cancelled" | "checked_in"; quantity: number; checkedInAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "events.create": {
    input: { name: string; slug: string; summary?: string; venueName?: string; venueAddress?: string; venueLocationId?: string | null };
    output: { id: string; name: string; slug: string; summary: string | null; venueName: string | null; venueAddress: string | null; venueLocationId: string | null; status: "draft" | "published" | "cancelled"; seo: unknown; workingName: string | null; workingSummary: string | null; workingVenueName: string | null; workingVenueAddress: string | null; workingSeo: unknown | null; version: number; publishedAt: string | null; cancelledAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "events.get": {
    input: { id: string };
    output: { event: { id: string; name: string; slug: string; summary: string | null; venueName: string | null; venueAddress: string | null; venueLocationId: string | null; status: "draft" | "published" | "cancelled"; seo: unknown; workingName: string | null; workingSummary: string | null; workingVenueName: string | null; workingVenueAddress: string | null; workingSeo: unknown | null; version: number; publishedAt: string | null; cancelledAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }; sessions: { id: string; eventId: string; startsAt: string; endsAt: string; timezone: string; capacity: number; waitlistEnabled: boolean; createdAt: string; updatedAt: string; remaining: number; [key: string]: unknown }[]; tickets: { id: string; eventId: string; name: string; priceMinor: number; currency: string; active: boolean; createdAt: string; updatedAt: string; [key: string]: unknown }[]; registrations: { id: string; eventId: string; sessionId: string; ticketId: string | null; contactId: string; status: "reserved" | "confirmed" | "waitlisted" | "cancelled" | "checked_in"; quantity: number; checkedInAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[] };
  };
  "events.list": {
    input: { status?: "draft" | "published" | "cancelled" };
    output: { id: string; name: string; slug: string; summary: string | null; venueName: string | null; venueAddress: string | null; venueLocationId: string | null; status: "draft" | "published" | "cancelled"; seo: unknown; workingName: string | null; workingSummary: string | null; workingVenueName: string | null; workingVenueAddress: string | null; workingSeo: unknown | null; version: number; publishedAt: string | null; cancelledAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "events.listPublic": {
    input: Record<string, never>;
    output: { id: string; name: string; slug: string; summary: string | null; venueName: string | null; venueAddress: string | null; venueLocationId: string | null; status: "draft" | "published" | "cancelled"; seo: unknown; workingName: string | null; workingSummary: string | null; workingVenueName: string | null; workingVenueAddress: string | null; workingSeo: unknown | null; version: number; publishedAt: string | null; cancelledAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "events.publish": {
    input: { id: string; expectedVersion: number };
    output: { id: string; name: string; slug: string; summary: string | null; venueName: string | null; venueAddress: string | null; venueLocationId: string | null; status: "draft" | "published" | "cancelled"; seo: unknown; workingName: string | null; workingSummary: string | null; workingVenueName: string | null; workingVenueAddress: string | null; workingSeo: unknown | null; version: number; publishedAt: string | null; cancelledAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "events.recentActivity": {
    input: { limit?: number };
    output: { id: string; actor: string; action: string; at: string; [key: string]: unknown }[];
  };
  "events.register": {
    input: { eventId: string; sessionId: string; ticketId?: string; email: string; name?: string; quantity?: number };
    output: { id: string; eventId: string; sessionId: string; ticketId: string | null; contactId: string; status: "reserved" | "confirmed" | "waitlisted" | "cancelled" | "checked_in"; quantity: number; checkedInAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "events.resolvePublic": {
    input: { slug: string };
    output: { id: string; name: string; slug: string; summary: string | null; venueName: string | null; venueAddress: string | null; venueLocationId: string | null; status: "draft" | "published" | "cancelled"; seo: unknown; workingName: string | null; workingSummary: string | null; workingVenueName: string | null; workingVenueAddress: string | null; workingSeo: unknown | null; version: number; publishedAt: string | null; cancelledAt: string | null; createdAt: string; updatedAt: string; sessions: { id: string; eventId: string; startsAt: string; endsAt: string; timezone: string; capacity: number; waitlistEnabled: boolean; createdAt: string; updatedAt: string; remaining: number; [key: string]: unknown }[]; [key: string]: unknown } | null;
  };
  "events.update": {
    input: { id: string; expectedVersion: number; name?: string; slug?: string; summary?: string | null; venueName?: string | null; venueAddress?: string | null; seo?: { title?: string; description?: string } };
    output: { id: string; name: string; slug: string; summary: string | null; venueName: string | null; venueAddress: string | null; venueLocationId: string | null; status: "draft" | "published" | "cancelled"; seo: unknown; workingName: string | null; workingSummary: string | null; workingVenueName: string | null; workingVenueAddress: string | null; workingSeo: unknown | null; version: number; publishedAt: string | null; cancelledAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "forms.byId": {
    input: { id: string };
    output: { id: string; slug: string; name: string; fields: unknown; submitLabel: string | null; successMessage: string | null; destination: "contact" | "none"; notify: string[]; status: "active" | "closed"; createdAt: string; updatedAt: string; [key: string]: unknown } | null;
  };
  "forms.create": {
    input: { slug: string; name: string; fields?: { key: string; label: string; kind: "text" | "email" | "tel" | "multiline" | "select" | "checkbox" | "number"; required?: boolean; placeholder?: string; help?: string; options?: string[]; maxLength?: number }[]; submitLabel?: string; successMessage?: string; destination?: "contact" | "none"; notify?: string[] };
    output: { id: string; slug: string; name: string; fields: unknown; submitLabel: string | null; successMessage: string | null; destination: "contact" | "none"; notify: string[]; status: "active" | "closed"; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "forms.delete": {
    input: { id: string };
    output: { id: string; slug: string; [key: string]: unknown };
  };
  "forms.get": {
    input: { slug: string };
    output: { id: string; slug: string; name: string; fields: unknown; submitLabel: string | null; successMessage: string | null; destination: "contact" | "none"; notify: string[]; status: "active" | "closed"; createdAt: string; updatedAt: string; [key: string]: unknown } | null;
  };
  "forms.list": {
    input: Record<string, never>;
    output: { id: string; slug: string; name: string; status: "active" | "closed"; destination: "contact" | "none"; fields: unknown; updatedAt: string; submissions: number; [key: string]: unknown }[];
  };
  "forms.listSubmissions": {
    input: { formId: string; status?: "received" | "spam" | "all"; limit?: number };
    output: { id: string; formId: string; contactId: string | null; data: unknown; sourceUrl: string | null; status: "received" | "spam"; spamReasons: string[]; createdAt: string; [key: string]: unknown }[];
  };
  "forms.loadDemoFixture": {
    input: { scenarioKey: string; scenarioVersion: number; runId: string; generation: number; locale: string; records?: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
    output: { records: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
  };
  "forms.purgeDemoFixture": {
    input: { scenarioKey: string; scenarioVersion: number; runId: string; generation: number; locale: string; records?: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
    output: { purged: { subjectType: string; subjectId: string }[] };
  };
  "forms.reviewSubmission": {
    input: { id: string; status: "received" | "spam" };
    output: { id: string; formId: string; contactId: string | null; data: unknown; sourceUrl: string | null; status: "received" | "spam"; spamReasons: string[]; createdAt: string; [key: string]: unknown };
  };
  "forms.submissionCounts": {
    input: Record<string, never>;
    output: { received: number; spam: number };
  };
  "forms.submit": {
    input: { slug: string; values: { [key: string]: unknown }; sourceUrl?: string };
    output: { ok: true; submissionId: string; message: string };
  };
  "forms.update": {
    input: { id: string; name?: string; fields?: { key: string; label: string; kind: "text" | "email" | "tel" | "multiline" | "select" | "checkbox" | "number"; required?: boolean; placeholder?: string; help?: string; options?: string[]; maxLength?: number }[]; submitLabel?: string | null; successMessage?: string | null; destination?: "contact" | "none"; notify?: string[]; status?: "active" | "closed" };
    output: { id: string; slug: string; name: string; fields: unknown; submitLabel: string | null; successMessage: string | null; destination: "contact" | "none"; notify: string[]; status: "active" | "closed"; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "forms.verifyDemoFixture": {
    input: { scenarioKey: string; scenarioVersion: number; runId: string; generation: number; locale: string; records?: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
    output: { outcomes: { key: string; achieved: boolean; detail?: string }[] };
  };
  "galleries.addItem": {
    input: { galleryId: string; assetId: string; canView?: boolean; canDownload?: boolean };
    output: { id: string; galleryId: string; assetId: string; position: number; canView: boolean; canDownload: boolean; filename?: string; altText?: string | null; mime?: string; status?: string; [key: string]: unknown };
  };
  "galleries.addPriceSheetItem": {
    input: { galleryId: string; variantId: string; position?: number };
    output: { id: string; galleryId: string; variantId: string; position: number; [key: string]: unknown };
  };
  "galleries.addToCart": {
    input: { sessionToken: string; itemId: string; variantId: string; cartId: string; quantity?: number };
    output: { ok: true };
  };
  "galleries.approveRound": {
    input: { galleryId: string; note?: string | null };
    output: { id: string; galleryId: string; sequence: number; state: "open" | "submitted" | "approved" | "reopened"; submittedByContactId: string | null; note: string | null; snapshot: { assetId: string; kind: "favorite" | "select" | "reject"; comment: string | null }[]; submittedAt: string | null; decidedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "galleries.archiveState": {
    input: { sessionToken: string };
    output: { id: string; galleryId: string; state: "building" | "ready" | "failed"; bytes: number | null; fileCount: number | null; error: string | null; builtAt: string | null; [key: string]: unknown } | null;
  };
  "galleries.clearSelection": {
    input: { sessionToken: string; itemId: string };
    output: { ok: true };
  };
  "galleries.create": {
    input: { contactId: string; title: string; slug?: string; access: "password" | "pin" | "login"; secret?: string; expiresAt?: string | null; downloadPolicy?: "none" | "web_res" | "full_res" | "limit_n"; downloadLimit?: number; watermark?: boolean; clientCanInvitePartner?: boolean };
    output: { id: string; contactId: string | null; title: string; slug: string; kind: "client_delivery"; coverAssetId: string | null; access: "password" | "pin" | "login"; secretSet: boolean; expiresAt: string | null; downloadPolicy: "none" | "web_res" | "full_res" | "limit_n"; downloadLimit: number | null; watermark: boolean; clientCanInvitePartner: boolean; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "galleries.downloadArchive": {
    input: { sessionToken: string };
    output: { storageKey: string; filename: string; bytes: number; [key: string]: unknown } | null;
  };
  "galleries.downloadItem": {
    input: { sessionToken: string; itemId: string };
    output: { assetId: string; storageKey: string; filename: string; mime: string; bytes: number; [key: string]: unknown };
  };
  "galleries.get": {
    input: { id: string };
    output: { id: string; contactId: string | null; title: string; slug: string; kind: "client_delivery"; coverAssetId: string | null; access: "password" | "pin" | "login"; secretSet: boolean; expiresAt: string | null; downloadPolicy: "none" | "web_res" | "full_res" | "limit_n"; downloadLimit: number | null; watermark: boolean; clientCanInvitePartner: boolean; createdAt: string; updatedAt: string; items: { id: string; galleryId: string; assetId: string; position: number; canView: boolean; canDownload: boolean; filename?: string; altText?: string | null; mime?: string; status?: string; [key: string]: unknown }[]; [key: string]: unknown };
  };
  "galleries.inviteGuest": {
    input: { galleryId: string; email: string; name?: string; role?: "client" | "partner"; canView?: boolean; canDownload?: boolean; expiresAt?: string | null };
    output: { id: string; galleryId: string; contactId: string; contactName?: string; contactEmail?: string | null; role: "client" | "partner"; canView: boolean; canDownload: boolean; expiresAt: string | null; revokedAt: string | null; invitedByContactId?: string | null; token: string; link: string; delivers: boolean; [key: string]: unknown };
  };
  "galleries.invitePartner": {
    input: { sessionToken: string; email: string; name?: string };
    output: { id: string; galleryId: string; contactId: string; contactName?: string; contactEmail?: string | null; role: "client" | "partner"; canView: boolean; canDownload: boolean; expiresAt: string | null; revokedAt: string | null; invitedByContactId?: string | null; token: string; link: string; delivers: boolean; [key: string]: unknown };
  };
  "galleries.list": {
    input: { limit?: number };
    output: { id: string; contactId: string | null; title: string; slug: string; kind: "client_delivery"; coverAssetId: string | null; access: "password" | "pin" | "login"; secretSet: boolean; expiresAt: string | null; downloadPolicy: "none" | "web_res" | "full_res" | "limit_n"; downloadLimit: number | null; watermark: boolean; clientCanInvitePartner: boolean; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "galleries.listAccess": {
    input: { galleryId: string; limit?: number };
    output: { id: string; galleryId: string; contactId: string | null; action: "view" | "download" | "denied"; assetId: string | null; at: string; [key: string]: unknown }[];
  };
  "galleries.listGuests": {
    input: { galleryId: string };
    output: { id: string; galleryId: string; contactId: string; contactName?: string; contactEmail?: string | null; role: "client" | "partner"; canView: boolean; canDownload: boolean; expiresAt: string | null; revokedAt: string | null; invitedByContactId?: string | null; [key: string]: unknown }[];
  };
  "galleries.listPriceSheet": {
    input: { galleryId: string };
    output: { id: string; galleryId: string; variantId: string; position: number; [key: string]: unknown }[];
  };
  "galleries.listRounds": {
    input: { galleryId: string };
    output: { id: string; galleryId: string; sequence: number; state: "open" | "submitted" | "approved" | "reopened"; submittedByContactId: string | null; note: string | null; snapshot: { assetId: string; kind: "favorite" | "select" | "reject"; comment: string | null }[]; submittedAt: string | null; decidedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "galleries.listSelections": {
    input: { galleryId: string };
    output: { id: string; galleryId: string; contactId: string | null; assetId: string; kind: "favorite" | "select" | "reject"; comment: string | null; createdAt: string; updatedAt: string; contactName?: string | null; filename?: string | null; [key: string]: unknown }[];
  };
  "galleries.loadDemoFixture": {
    input: { scenarioKey: string; scenarioVersion: number; runId: string; generation: number; locale: string; records?: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
    output: { records: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
  };
  "galleries.openWithLogin": {
    input: { slug: string };
    output: { ok: true; sessionToken: string; gallery: { id: string; title: string; slug: string; access: "password" | "pin" | "login"; downloadPolicy: "none" | "web_res" | "full_res" | "limit_n"; watermark: boolean; expiresAt: string | null; [key: string]: unknown }; items: { id: string; galleryId: string; assetId: string; position: number; canView: boolean; canDownload: boolean; filename?: string; altText?: string | null; mime?: string; status?: string; [key: string]: unknown }[]; selections: { id: string; galleryId: string; contactId: string | null; assetId: string; kind: "favorite" | "select" | "reject"; comment: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[]; round: { id: string; galleryId: string; sequence: number; state: "open" | "submitted" | "approved" | "reopened"; submittedByContactId: string | null; note: string | null; snapshot: { assetId: string; kind: "favorite" | "select" | "reject"; comment: string | null }[]; submittedAt: string | null; decidedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown } | null; lastDecided: { id: string; galleryId: string; sequence: number; state: "open" | "submitted" | "approved" | "reopened"; submittedByContactId: string | null; note: string | null; snapshot: { assetId: string; kind: "favorite" | "select" | "reject"; comment: string | null }[]; submittedAt: string | null; decidedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown } | null; canInvitePartner: boolean; invitedPartners: { id: string; galleryId: string; contactId: string; contactName?: string; contactEmail?: string | null; role: "client" | "partner"; canView: boolean; canDownload: boolean; expiresAt: string | null; revokedAt: string | null; invitedByContactId?: string | null; [key: string]: unknown }[] } | { ok: false };
  };
  "galleries.publicBySlug": {
    input: { slug: string };
    output: { title: string; slug: string; access: "password" | "pin" | "login"; expired: boolean; [key: string]: unknown } | null;
  };
  "galleries.purgeDemoFixture": {
    input: { scenarioKey: string; scenarioVersion: number; runId: string; generation: number; locale: string; records?: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
    output: { purged: { subjectType: string; subjectId: string }[] };
  };
  "galleries.redeemGuest": {
    input: { token: string };
    output: { ok: true; sessionToken: string; gallery: { id: string; title: string; slug: string; access: "password" | "pin" | "login"; downloadPolicy: "none" | "web_res" | "full_res" | "limit_n"; watermark: boolean; expiresAt: string | null; [key: string]: unknown }; items: { id: string; galleryId: string; assetId: string; position: number; canView: boolean; canDownload: boolean; filename?: string; altText?: string | null; mime?: string; status?: string; [key: string]: unknown }[]; selections: { id: string; galleryId: string; contactId: string | null; assetId: string; kind: "favorite" | "select" | "reject"; comment: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[]; round: { id: string; galleryId: string; sequence: number; state: "open" | "submitted" | "approved" | "reopened"; submittedByContactId: string | null; note: string | null; snapshot: { assetId: string; kind: "favorite" | "select" | "reject"; comment: string | null }[]; submittedAt: string | null; decidedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown } | null; lastDecided: { id: string; galleryId: string; sequence: number; state: "open" | "submitted" | "approved" | "reopened"; submittedByContactId: string | null; note: string | null; snapshot: { assetId: string; kind: "favorite" | "select" | "reject"; comment: string | null }[]; submittedAt: string | null; decidedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown } | null; canInvitePartner: boolean; invitedPartners: { id: string; galleryId: string; contactId: string; contactName?: string; contactEmail?: string | null; role: "client" | "partner"; canView: boolean; canDownload: boolean; expiresAt: string | null; revokedAt: string | null; invitedByContactId?: string | null; [key: string]: unknown }[] } | { ok: false };
  };
  "galleries.removeItem": {
    input: { id: string };
    output: { ok: true };
  };
  "galleries.removePriceSheetItem": {
    input: { id: string };
    output: { ok: true };
  };
  "galleries.reopenRound": {
    input: { galleryId: string; note?: string | null };
    output: { id: string; galleryId: string; sequence: number; state: "open" | "submitted" | "approved" | "reopened"; submittedByContactId: string | null; note: string | null; snapshot: { assetId: string; kind: "favorite" | "select" | "reject"; comment: string | null }[]; submittedAt: string | null; decidedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "galleries.requestArchive": {
    input: { sessionToken: string };
    output: { id: string; galleryId: string; state: "building" | "ready" | "failed"; bytes: number | null; fileCount: number | null; error: string | null; builtAt: string | null; [key: string]: unknown };
  };
  "galleries.revokeGuest": {
    input: { id: string };
    output: { ok: true };
  };
  "galleries.revokePartner": {
    input: { sessionToken: string; id: string };
    output: { ok: true };
  };
  "galleries.setSelection": {
    input: { sessionToken: string; itemId: string; kind: "favorite" | "select" | "reject"; comment?: string | null };
    output: { id: string; galleryId: string; contactId: string | null; assetId: string; kind: "favorite" | "select" | "reject"; comment: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "galleries.submitRound": {
    input: { sessionToken: string };
    output: { id: string; galleryId: string; sequence: number; state: "open" | "submitted" | "approved" | "reopened"; submittedByContactId: string | null; note: string | null; snapshot: { assetId: string; kind: "favorite" | "select" | "reject"; comment: string | null }[]; submittedAt: string | null; decidedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "galleries.unlock": {
    input: { slug: string; secret: string };
    output: { ok: true; sessionToken: string; gallery: { id: string; title: string; slug: string; access: "password" | "pin" | "login"; downloadPolicy: "none" | "web_res" | "full_res" | "limit_n"; watermark: boolean; expiresAt: string | null; [key: string]: unknown }; items: { id: string; galleryId: string; assetId: string; position: number; canView: boolean; canDownload: boolean; filename?: string; altText?: string | null; mime?: string; status?: string; [key: string]: unknown }[]; selections: { id: string; galleryId: string; contactId: string | null; assetId: string; kind: "favorite" | "select" | "reject"; comment: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[]; round: { id: string; galleryId: string; sequence: number; state: "open" | "submitted" | "approved" | "reopened"; submittedByContactId: string | null; note: string | null; snapshot: { assetId: string; kind: "favorite" | "select" | "reject"; comment: string | null }[]; submittedAt: string | null; decidedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown } | null; lastDecided: { id: string; galleryId: string; sequence: number; state: "open" | "submitted" | "approved" | "reopened"; submittedByContactId: string | null; note: string | null; snapshot: { assetId: string; kind: "favorite" | "select" | "reject"; comment: string | null }[]; submittedAt: string | null; decidedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown } | null; canInvitePartner: boolean; invitedPartners: { id: string; galleryId: string; contactId: string; contactName?: string; contactEmail?: string | null; role: "client" | "partner"; canView: boolean; canDownload: boolean; expiresAt: string | null; revokedAt: string | null; invitedByContactId?: string | null; [key: string]: unknown }[] } | { ok: false };
  };
  "galleries.update": {
    input: { id: string; title?: string; access?: "password" | "pin" | "login"; secret?: string | null; expiresAt?: string | null; downloadPolicy?: "none" | "web_res" | "full_res" | "limit_n"; downloadLimit?: number | null; watermark?: boolean; clientCanInvitePartner?: boolean; coverAssetId?: string | null };
    output: { id: string; contactId: string | null; title: string; slug: string; kind: "client_delivery"; coverAssetId: string | null; access: "password" | "pin" | "login"; secretSet: boolean; expiresAt: string | null; downloadPolicy: "none" | "web_res" | "full_res" | "limit_n"; downloadLimit: number | null; watermark: boolean; clientCanInvitePartner: boolean; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "galleries.updateItem": {
    input: { id: string; canView?: boolean; canDownload?: boolean };
    output: { id: string; galleryId: string; assetId: string; position: number; canView: boolean; canDownload: boolean; filename?: string; altText?: string | null; mime?: string; status?: string; [key: string]: unknown };
  };
  "galleries.verifyDemoFixture": {
    input: { scenarioKey: string; scenarioVersion: number; runId: string; generation: number; locale: string; records?: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
    output: { outcomes: { key: string; achieved: boolean; detail?: string }[] };
  };
  "galleries.viewItem": {
    input: { sessionToken: string; itemId: string };
    output: { assetId: string; storageKey: string; filename: string; mime: string; bytes: number; [key: string]: unknown } | null;
  };
  "galleries.viewSession": {
    input: { sessionToken: string };
    output: { ok: true; sessionToken: string; gallery: { id: string; title: string; slug: string; access: "password" | "pin" | "login"; downloadPolicy: "none" | "web_res" | "full_res" | "limit_n"; watermark: boolean; expiresAt: string | null; [key: string]: unknown }; items: { id: string; galleryId: string; assetId: string; position: number; canView: boolean; canDownload: boolean; filename?: string; altText?: string | null; mime?: string; status?: string; [key: string]: unknown }[]; selections: { id: string; galleryId: string; contactId: string | null; assetId: string; kind: "favorite" | "select" | "reject"; comment: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[]; round: { id: string; galleryId: string; sequence: number; state: "open" | "submitted" | "approved" | "reopened"; submittedByContactId: string | null; note: string | null; snapshot: { assetId: string; kind: "favorite" | "select" | "reject"; comment: string | null }[]; submittedAt: string | null; decidedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown } | null; lastDecided: { id: string; galleryId: string; sequence: number; state: "open" | "submitted" | "approved" | "reopened"; submittedByContactId: string | null; note: string | null; snapshot: { assetId: string; kind: "favorite" | "select" | "reject"; comment: string | null }[]; submittedAt: string | null; decidedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown } | null; canInvitePartner: boolean; invitedPartners: { id: string; galleryId: string; contactId: string; contactName?: string; contactEmail?: string | null; role: "client" | "partner"; canView: boolean; canDownload: boolean; expiresAt: string | null; revokedAt: string | null; invitedByContactId?: string | null; [key: string]: unknown }[] };
  };
  "giftRegistry.addItem": {
    input: { registryId: string; title: string; url?: string; amountCents?: number; currency?: string };
    output: { id: string; registryId: string; title: string; url: string | null; amountCents: number; currency: string; status: string; invoiceId: string | null; lastError: string | null; [key: string]: unknown };
  };
  "giftRegistry.contribute": {
    input: { slug: string; itemId: string; email: string; name: string };
    output: { id: string; registryId: string; title: string; url: string | null; amountCents: number; currency: string; status: string; invoiceId: string | null; lastError: string | null; [key: string]: unknown };
  };
  "giftRegistry.create": {
    input: { contactId: string; title: string; slug: string };
    output: { id: string; contactId: string; title: string; slug: string; [key: string]: unknown };
  };
  "giftRegistry.getBySlug": {
    input: { slug: string };
    output: { registry: { id: string; contactId: string; title: string; slug: string; [key: string]: unknown }; items: { id: string; registryId: string; title: string; url: string | null; amountCents: number; currency: string; status: string; invoiceId: string | null; lastError: string | null; [key: string]: unknown }[]; [key: string]: unknown };
  };
  "giftRegistry.invoiceItem": {
    input: { itemId: string };
    output: { id: string; registryId: string; title: string; url: string | null; amountCents: number; currency: string; status: string; invoiceId: string | null; lastError: string | null; [key: string]: unknown };
  };
  "giftRegistry.list": {
    input: Record<string, never>;
    output: { id: string; contactId: string; title: string; slug: string; [key: string]: unknown }[];
  };
  "giftRegistry.listItems": {
    input: { registryId: string };
    output: { id: string; registryId: string; title: string; url: string | null; amountCents: number; currency: string; status: string; invoiceId: string | null; lastError: string | null; [key: string]: unknown }[];
  };
  "guidance.contexts": {
    input: Record<string, never>;
    output: { key: string; titleKey: string; audienceMatch: boolean; hrefs: string[]; [key: string]: unknown }[];
  };
  "guidance.dismiss": {
    input: { flowKey: string };
    output: { key: string; version: number; state: "active" | "dismissed" };
  };
  "guidance.list": {
    input: { flowKey?: string };
    output: { key: string; version: number; titleKey: string; descriptionKey: string; audienceRoles: string[]; requiredCapabilities: string[]; audienceMatch: boolean; state: "not_started" | "active" | "dismissed" | "completed"; completedCount: number; totalCount: number; startedAt: string | null; completedAt: string | null; steps: { key: string; titleKey: string; descriptionKey: string; href: string; requiredCapabilities: string[]; outcome: { type: "audit"; actions: string[] } | { type: "form-submission" } | { type: "portal-account-linked" }; completed: boolean }[]; [key: string]: unknown }[];
  };
  "guidance.reset": {
    input: { flowKey: string };
    output: { key: string; version: number; state: "active" | "dismissed" };
  };
  "guidance.start": {
    input: { flowKey: string };
    output: { key: string; version: number; state: "active" | "dismissed" };
  };
  "i18n.deleteTranslation": {
    input: { id: string };
    output: { ok: true };
  };
  "i18n.getMyLocale": {
    input: Record<string, never>;
    output: { defaultLocale: string; enabledLocales: string[]; locale: string; [key: string]: unknown };
  };
  "i18n.getTranslation": {
    input: { entityType: string; entityId: string; locale: string; includeUnreviewed?: boolean };
    output: { id: string; entityType: string; entityId: string; locale: string; fields: unknown; status: "draft" | "machine" | "reviewed"; translatedBy: string | null; createdAt: string; updatedAt: string; [key: string]: unknown } | null;
  };
  "i18n.listTranslations": {
    input: { entityType: string; entityId: string };
    output: { id: string; entityType: string; entityId: string; locale: string; fields: unknown; status: "draft" | "machine" | "reviewed"; translatedBy: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "i18n.setMyLocale": {
    input: { locale: string };
    output: { defaultLocale: string; enabledLocales: string[]; locale: string; [key: string]: unknown };
  };
  "i18n.setTranslation": {
    input: { entityType: string; entityId: string; locale: string; fields: { [key: string]: unknown }; status?: "draft" | "machine" | "reviewed" };
    output: { id: string; entityType: string; entityId: string; locale: string; fields: unknown; status: "draft" | "machine" | "reviewed"; translatedBy: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "i18n.translatedIds": {
    input: { entityType: string; locale: string; ids?: string[] };
    output: string[];
  };
  "i18n.translationIndex": {
    input: { entityType: string };
    output: { id: string; entityId: string; locale: string; status: "draft" | "machine" | "reviewed"; updatedAt: string; [key: string]: unknown }[];
  };
  "imports.commit": {
    input: { id: string };
    output: { id: string; source: string; status: "discover" | "mapped" | "previewed" | "committed" | "reconciled" | "published" | "rolled_back" | "failed"; checkpoint: unknown; preview: unknown; counts: unknown; error: string | null; createdBy: string; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "imports.list": {
    input: Record<string, never>;
    output: { id: string; source: string; status: "discover" | "mapped" | "previewed" | "committed" | "reconciled" | "published" | "rolled_back" | "failed"; checkpoint: unknown; preview: unknown; counts: unknown; error: string | null; createdBy: string; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "imports.map": {
    input: { id: string; mapping: { url: string; slug: string; title: string; kind: "page" | "post" }[] };
    output: { id: string; source: string; status: "discover" | "mapped" | "previewed" | "committed" | "reconciled" | "published" | "rolled_back" | "failed"; checkpoint: unknown; preview: unknown; counts: unknown; error: string | null; createdBy: string; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "imports.preview": {
    input: { id: string; pages: { url: string; slug: string; title: string }[] };
    output: { id: string; source: string; status: "discover" | "mapped" | "previewed" | "committed" | "reconciled" | "published" | "rolled_back" | "failed"; checkpoint: unknown; preview: unknown; counts: unknown; error: string | null; createdBy: string; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "imports.previewFromSource": {
    input: { id: string; payload: string; robotsTxt?: string };
    output: { id: string; source: string; status: "discover" | "mapped" | "previewed" | "committed" | "reconciled" | "published" | "rolled_back" | "failed"; checkpoint: unknown; preview: unknown; counts: unknown; error: string | null; createdBy: string; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "imports.publish": {
    input: { id: string };
    output: { id: string; source: string; status: "discover" | "mapped" | "previewed" | "committed" | "reconciled" | "published" | "rolled_back" | "failed"; checkpoint: unknown; preview: unknown; counts: unknown; error: string | null; createdBy: string; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "imports.reconcile": {
    input: { id: string; counts: { pages: number; media: number; redirects: number } };
    output: { id: string; source: string; status: "discover" | "mapped" | "previewed" | "committed" | "reconciled" | "published" | "rolled_back" | "failed"; checkpoint: unknown; preview: unknown; counts: unknown; error: string | null; createdBy: string; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "imports.reviewConflicts": {
    input: { id: string; conflicts: { slug: string; resolution: "keep-existing" | "replace" | "rename"; renamedSlug?: string }[] };
    output: { id: string; source: string; status: "discover" | "mapped" | "previewed" | "committed" | "reconciled" | "published" | "rolled_back" | "failed"; checkpoint: unknown; preview: unknown; counts: unknown; error: string | null; createdBy: string; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "imports.rollback": {
    input: { id: string };
    output: { id: string; source: string; status: "discover" | "mapped" | "previewed" | "committed" | "reconciled" | "published" | "rolled_back" | "failed"; checkpoint: unknown; preview: unknown; counts: unknown; error: string | null; createdBy: string; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "imports.start": {
    input: { origin: string; kind: "wordpress-rest" | "wordpress-wxr" | "sitemap" | "rss" | "atom" | "html" | "archive" };
    output: { id: string; source: string; status: "discover" | "mapped" | "previewed" | "committed" | "reconciled" | "published" | "rolled_back" | "failed"; checkpoint: unknown; preview: unknown; counts: unknown; error: string | null; createdBy: string; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "invitations.accept": {
    input: { token: string; password: string };
    output: { userId: string; email: string; role: string; [key: string]: unknown };
  };
  "invitations.create": {
    input: { email: string; roleKey: string; expiresInDays?: number };
    output: { id: string; expiresAt: string; delivery: "sent" | "logged"; [key: string]: unknown };
  };
  "invitations.inspect": {
    input: { token: string };
    output: { status: "invalid" } | { status: "unavailable"; email: string } | { status: "accepted"; email: string } | { status: "revoked"; email: string } | { status: "expired"; email: string } | { status: "pending"; email: string; roleName: string; expiresAt: string };
  };
  "invitations.list": {
    input: Record<string, never>;
    output: { id: string; email: string; roleKey: string; roleName: string; status: "pending" | "accepted" | "revoked" | "expired"; expiresAt: string; createdBy: string; sendCount: number; lastAttemptedAt: string; lastSentAt: string | null; deliveryAdapter: string | null; acceptedAt: string | null; revokedAt: string | null; createdAt: string; history: { action: string; actor: string; at: string; [key: string]: unknown }[]; [key: string]: unknown }[];
  };
  "invitations.resend": {
    input: { id: string };
    output: { id: string; expiresAt: string; delivery: "sent" | "logged"; [key: string]: unknown };
  };
  "invitations.revoke": {
    input: { id: string };
    output: { id: string; [key: string]: unknown };
  };
  "invitations.roles": {
    input: Record<string, never>;
    output: { key: string; name: string; description: string; [key: string]: unknown }[];
  };
  "invoicing.addTaxRate": {
    input: { zoneId: string; categoryId?: string; name: string; jurisdiction: string; ratePpm: number; compound?: boolean; priority?: number; appliesToShipping?: boolean; effectiveFrom?: string; effectiveTo?: string };
    output: { id: string; zoneId: string; categoryId: string | null; name: string; jurisdiction: string; ratePpm: number; compound: boolean; priority: number; appliesToShipping: boolean; effectiveFrom: string | null; effectiveTo: string | null; active: boolean; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "invoicing.adjustCustomerBalance": {
    input: { contactId: string; currency: string; direction: "credit" | "debit"; amountMinor: number; reason: string; externalReference?: string; idempotencyKey: string };
    output: { account: { id: string; contactId: string; currency: string; balanceMinor: number; createdAt: string; updatedAt: string; [key: string]: unknown }; entry: { id: string; accountId: string; kind: "credit" | "debit" | "refund" | "adjustment"; deltaMinor: number; balanceAfterMinor: number; sourceType: string; sourceId: string | null; idempotencyKey: string; requestHash: string; reason: string; actor: string; createdAt: string; [key: string]: unknown } };
  };
  "invoicing.applyCustomerBalance": {
    input: { invoiceId: string; amountMinor: number; idempotencyKey: string };
    output: { payment: { id: string; invoiceId: string; provider: string; providerCheckoutRef: string | null; providerRef: string | null; idempotencyKey: string; requestHash: string; status: "created" | "processing" | "succeeded" | "failed" | "cancelled"; method: string; currency: string; amountMinor: number; refundedMinor: number; failureCode: string | null; failureMessage: string | null; processedAt: string | null; failedAt: string | null; metadata: unknown; createdAt: string; updatedAt: string; [key: string]: unknown }; account: { id: string; contactId: string; currency: string; balanceMinor: number; createdAt: string; updatedAt: string; [key: string]: unknown }; entry?: { id: string; accountId: string; kind: "credit" | "debit" | "refund" | "adjustment"; deltaMinor: number; balanceAfterMinor: number; sourceType: string; sourceId: string | null; idempotencyKey: string; requestHash: string; reason: string; actor: string; createdAt: string; [key: string]: unknown } };
  };
  "invoicing.assessLateFee": {
    input: { invoiceId: string; terms: { basis: "fixed"; fixedMinor: number; capMinor?: number } | { basis: "percentage"; ratePpm: number; capMinor?: number }; graceDays?: number; asOf?: string; reason: string; taxCategoryCode?: string; tax: { mode: "calculate"; origin: { city?: string; region?: string; postalCode?: string; country: string }; destination: { city?: string; region?: string; postalCode?: string; country: string } } | { mode: "not_applicable"; reason: string }; dueAt?: string; issueNow?: boolean; idempotencyKey: string };
    output: { assessment: { id: string; sourceInvoiceId: string; feeInvoiceId: string; basis: "fixed" | "percentage"; outstandingMinor: number; fixedMinor: number | null; ratePpm: number | null; capMinor: number | null; graceDays: number; assessedMinor: number; assessedAt: string; reason: string; idempotencyKey: string; requestHash: string; createdAt: string; [key: string]: unknown }; invoice: { id: string; contactId: string; number: string | null; sequenceKey: string; sourceType: "order" | "quote" | "booking" | "subscription" | "manual" | "deposit" | "balance" | "tip" | "pay_what_you_want" | "late_fee" | "unlock" | "ad_campaign"; sourceId: string | null; idempotencyKey: string; requestHash: string; status: "draft" | "sent" | "viewed" | "partially_paid" | "paid" | "overdue" | "void" | "refunded"; currency: string; subtotalMinor: number; discountMinor: number; shippingMinor: number; taxMinor: number; taxZoneId: string | null; totalMinor: number; paidMinor: number; refundedMinor: number; billingAddress: unknown | null; customerTaxId: string | null; requiredTaxLegend: string | null; memo: string | null; schedule: unknown | null; depositOfInvoiceId: string | null; dueAt: string | null; issuedAt: string | null; viewedAt: string | null; paidAt: string | null; voidedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown } };
  };
  "invoicing.beginInPersonPayment": {
    input: { invoiceId: string; locationId: string; method: "cash" | "card_present" | "tap_to_pay"; amountMinor?: number; readerRef?: string; idempotencyKey: string };
    output: { payment: { id: string; invoiceId: string; provider: string; providerCheckoutRef: string | null; providerRef: string | null; idempotencyKey: string; requestHash: string; status: "created" | "processing" | "succeeded" | "failed" | "cancelled"; method: string; currency: string; amountMinor: number; refundedMinor: number; failureCode: string | null; failureMessage: string | null; processedAt: string | null; failedAt: string | null; metadata: unknown; createdAt: string; updatedAt: string; [key: string]: unknown }; collection: { providerRef: string; status: "requires_reader" | "processing" | "succeeded" | "failed"; readerActionToken?: string }; receipt: { receiptNumber: string; issuedAt: string; invoice: { id: string; number: string; issuedAt: string; currency: string; totalMinor: number }; customer: { id: string; name: string | null; email: string | null }; payment: { id: string; provider: string; providerRef: string; method: string; amountMinor: number; refundedMinor: number; netMinor: number }; lines: { id: string; invoiceId: string; position: number; sourceType: string | null; sourceId: string | null; description: string; quantityMicros: number; unitAmountMinor: number; subtotalMinor: number; discountMinor: number; taxMinor: number; totalMinor: number; taxCategoryCode: string; snapshot: unknown; createdAt: string; [key: string]: unknown }[]; taxLines: { id: string; invoiceId: string; invoiceLineId: string | null; kind: "item" | "shipping" | "exemption"; rateName: string; ratePpm: number; taxableMinor: number; amountMinor: number; jurisdiction: string; registrationNumber: string | null; inclusive: boolean; compound: boolean; priority: number; exemptionKind: string | null; explanation: string; createdAt: string; [key: string]: unknown }[]; refunds: { id: string; paymentId: string; invoiceId: string; provider: string; providerRef: string | null; idempotencyKey: string; requestHash: string; status: "created" | "processing" | "succeeded" | "failed" | "cancelled"; currency: string; amountMinor: number; reason: string | null; failureCode: string | null; failureMessage: string | null; processedAt: string | null; failedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[]; requiredTaxLegend: string | null } | null };
  };
  "invoicing.beginPaymentCheckout": {
    input: { invoiceId: string; provider: "stripe" | "paypal" | "square" | "mollie" | "razorpay" | "paystack" | "flutterwave"; amountMinor?: number; methodIds?: string[]; saveMethod?: boolean; saveMethodConsent?: true; successUrl: string; cancelUrl: string; idempotencyKey: string };
    output: { payment: { id: string; invoiceId: string; provider: string; providerCheckoutRef: string | null; providerRef: string | null; idempotencyKey: string; requestHash: string; status: "created" | "processing" | "succeeded" | "failed" | "cancelled"; method: string; currency: string; amountMinor: number; refundedMinor: number; failureCode: string | null; failureMessage: string | null; processedAt: string | null; failedAt: string | null; metadata: unknown; createdAt: string; updatedAt: string; [key: string]: unknown }; checkout: { providerRef: string; paymentRef?: string; url: string; expiresAt?: string } };
  };
  "invoicing.cancelPayment": {
    input: { id: string; reason: string };
    output: { id: string; invoiceId: string; provider: string; providerCheckoutRef: string | null; providerRef: string | null; idempotencyKey: string; requestHash: string; status: "created" | "processing" | "succeeded" | "failed" | "cancelled"; method: string; currency: string; amountMinor: number; refundedMinor: number; failureCode: string | null; failureMessage: string | null; processedAt: string | null; failedAt: string | null; metadata: unknown; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "invoicing.cancelPaymentPlan": {
    input: { id: string; reason: string };
    output: { id: string; invoiceId: string; idempotencyKey: string; requestHash: string; status: "active" | "completed" | "defaulted" | "cancelled"; currency: string; principalMinor: number; paidMinor: number; cancelledAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "invoicing.cancelRefund": {
    input: { id: string; reason: string };
    output: { id: string; paymentId: string; invoiceId: string; provider: string; providerRef: string | null; idempotencyKey: string; requestHash: string; status: "created" | "processing" | "succeeded" | "failed" | "cancelled"; currency: string; amountMinor: number; reason: string | null; failureCode: string | null; failureMessage: string | null; processedAt: string | null; failedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "invoicing.completePaymentCheckout": {
    input: { paymentId: string; idempotencyKey: string };
    output: { id: string; invoiceId: string; provider: string; providerCheckoutRef: string | null; providerRef: string | null; idempotencyKey: string; requestHash: string; status: "created" | "processing" | "succeeded" | "failed" | "cancelled"; method: string; currency: string; amountMinor: number; refundedMinor: number; failureCode: string | null; failureMessage: string | null; processedAt: string | null; failedAt: string | null; metadata: unknown; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "invoicing.createCreditNote": {
    input: { invoiceId: string; idempotencyKey: string; reason: string; lines: { invoiceLineId?: string; description: string; quantityMicros: number; subtotalMinor: number; taxMinor?: number }[] };
    output: { id: string; invoiceId: string; number: string | null; sequenceKey: string; idempotencyKey: string; requestHash: string; status: "draft" | "issued" | "void"; currency: string; reason: string; subtotalMinor: number; taxMinor: number; totalMinor: number; issuedAt: string | null; voidedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "invoicing.createDepositAndBalance": {
    input: { contactId: string; currency: string; sourceType: "order" | "quote" | "booking" | "subscription" | "manual"; sourceId: string; deposit: { lines: { sourceType?: string; sourceId?: string; description: string; quantityMicros: number; unitAmountMinor: number; discountMinor?: number; taxCategoryCode?: string; requiresShipping?: boolean; snapshot?: { [key: string]: unknown } }[]; shippingMinor?: number; dueAt?: string }; balance: { lines: { sourceType?: string; sourceId?: string; description: string; quantityMicros: number; unitAmountMinor: number; discountMinor?: number; taxCategoryCode?: string; requiresShipping?: boolean; snapshot?: { [key: string]: unknown } }[]; shippingMinor?: number; dueAt?: string }; billingAddress?: { name?: string; street1?: string; street2?: string; city?: string; region?: string; postalCode?: string; country: string }; customerTaxId?: string; memo?: string; tax: { mode: "calculate"; origin: { city?: string; region?: string; postalCode?: string; country: string }; destination: { city?: string; region?: string; postalCode?: string; country: string } } | { mode: "not_applicable"; reason: string }; issueNow?: boolean; idempotencyKey: string };
    output: { deposit: { id: string; contactId: string; number: string | null; sequenceKey: string; sourceType: "order" | "quote" | "booking" | "subscription" | "manual" | "deposit" | "balance" | "tip" | "pay_what_you_want" | "late_fee" | "unlock" | "ad_campaign"; sourceId: string | null; idempotencyKey: string; requestHash: string; status: "draft" | "sent" | "viewed" | "partially_paid" | "paid" | "overdue" | "void" | "refunded"; currency: string; subtotalMinor: number; discountMinor: number; shippingMinor: number; taxMinor: number; taxZoneId: string | null; totalMinor: number; paidMinor: number; refundedMinor: number; billingAddress: unknown | null; customerTaxId: string | null; requiredTaxLegend: string | null; memo: string | null; schedule: unknown | null; depositOfInvoiceId: string | null; dueAt: string | null; issuedAt: string | null; viewedAt: string | null; paidAt: string | null; voidedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }; balance: { id: string; contactId: string; number: string | null; sequenceKey: string; sourceType: "order" | "quote" | "booking" | "subscription" | "manual" | "deposit" | "balance" | "tip" | "pay_what_you_want" | "late_fee" | "unlock" | "ad_campaign"; sourceId: string | null; idempotencyKey: string; requestHash: string; status: "draft" | "sent" | "viewed" | "partially_paid" | "paid" | "overdue" | "void" | "refunded"; currency: string; subtotalMinor: number; discountMinor: number; shippingMinor: number; taxMinor: number; taxZoneId: string | null; totalMinor: number; paidMinor: number; refundedMinor: number; billingAddress: unknown | null; customerTaxId: string | null; requiredTaxLegend: string | null; memo: string | null; schedule: unknown | null; depositOfInvoiceId: string | null; dueAt: string | null; issuedAt: string | null; viewedAt: string | null; paidAt: string | null; voidedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown } };
  };
  "invoicing.createDraft": {
    input: { contactId: string; currency: string; sourceType?: "order" | "quote" | "booking" | "subscription" | "manual" | "deposit" | "balance" | "tip" | "pay_what_you_want" | "late_fee" | "unlock" | "ad_campaign"; sourceId?: string; idempotencyKey: string; lines: { sourceType?: string; sourceId?: string; description: string; quantityMicros: number; unitAmountMinor: number; discountMinor?: number; taxCategoryCode?: string; requiresShipping?: boolean; snapshot?: { [key: string]: unknown } }[]; shippingMinor?: number; billingAddress?: { name?: string; street1?: string; street2?: string; city?: string; region?: string; postalCode?: string; country: string }; customerTaxId?: string; memo?: string; schedule?: { [key: string]: unknown }; depositOfInvoiceId?: string; dueAt?: string; tax: { mode: "calculate"; origin: { city?: string; region?: string; postalCode?: string; country: string }; destination: { city?: string; region?: string; postalCode?: string; country: string } } | { mode: "not_applicable"; reason: string } };
    output: { invoice: { id: string; contactId: string; number: string | null; sequenceKey: string; sourceType: "order" | "quote" | "booking" | "subscription" | "manual" | "deposit" | "balance" | "tip" | "pay_what_you_want" | "late_fee" | "unlock" | "ad_campaign"; sourceId: string | null; idempotencyKey: string; requestHash: string; status: "draft" | "sent" | "viewed" | "partially_paid" | "paid" | "overdue" | "void" | "refunded"; currency: string; subtotalMinor: number; discountMinor: number; shippingMinor: number; taxMinor: number; taxZoneId: string | null; totalMinor: number; paidMinor: number; refundedMinor: number; billingAddress: unknown | null; customerTaxId: string | null; requiredTaxLegend: string | null; memo: string | null; schedule: unknown | null; depositOfInvoiceId: string | null; dueAt: string | null; issuedAt: string | null; viewedAt: string | null; paidAt: string | null; voidedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }; lines: { id: string; invoiceId: string; position: number; sourceType: string | null; sourceId: string | null; description: string; quantityMicros: number; unitAmountMinor: number; subtotalMinor: number; discountMinor: number; taxMinor: number; totalMinor: number; taxCategoryCode: string; snapshot: unknown; createdAt: string; [key: string]: unknown }[]; taxLines: { id: string; invoiceId: string; invoiceLineId: string | null; kind: "item" | "shipping" | "exemption"; rateName: string; ratePpm: number; taxableMinor: number; amountMinor: number; jurisdiction: string; registrationNumber: string | null; inclusive: boolean; compound: boolean; priority: number; exemptionKind: string | null; explanation: string; createdAt: string; [key: string]: unknown }[]; payments: { id: string; invoiceId: string; provider: string; providerCheckoutRef: string | null; providerRef: string | null; idempotencyKey: string; requestHash: string; status: "created" | "processing" | "succeeded" | "failed" | "cancelled"; method: string; currency: string; amountMinor: number; refundedMinor: number; failureCode: string | null; failureMessage: string | null; processedAt: string | null; failedAt: string | null; metadata: unknown; createdAt: string; updatedAt: string; [key: string]: unknown }[]; refunds: { id: string; paymentId: string; invoiceId: string; provider: string; providerRef: string | null; idempotencyKey: string; requestHash: string; status: "created" | "processing" | "succeeded" | "failed" | "cancelled"; currency: string; amountMinor: number; reason: string | null; failureCode: string | null; failureMessage: string | null; processedAt: string | null; failedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[]; creditNotes: { id: string; invoiceId: string; number: string | null; sequenceKey: string; idempotencyKey: string; requestHash: string; status: "draft" | "issued" | "void"; currency: string; reason: string; subtotalMinor: number; taxMinor: number; totalMinor: number; issuedAt: string | null; voidedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[] };
  };
  "invoicing.createFlexiblePayment": {
    input: { kind: "tip" | "pay_what_you_want"; contactId: string; currency: string; chosenMinor: number; minimumMinor?: number; maximumMinor?: number; context: "checkout" | "invoice" | "gallery" | "booking" | "store" | "other"; attachedInvoiceId?: string; description: string; message?: string; taxCategoryCode?: string; tax: { mode: "calculate"; origin: { city?: string; region?: string; postalCode?: string; country: string }; destination: { city?: string; region?: string; postalCode?: string; country: string } } | { mode: "not_applicable"; reason: string }; dueAt?: string; issueNow?: boolean; idempotencyKey: string };
    output: { flexiblePayment: { id: string; invoiceId: string; attachedInvoiceId: string | null; kind: "tip" | "pay_what_you_want"; context: "checkout" | "invoice" | "gallery" | "booking" | "store" | "other"; chosenMinor: number; minimumMinor: number; maximumMinor: number | null; message: string | null; idempotencyKey: string; requestHash: string; createdAt: string; [key: string]: unknown }; invoice: { id: string; contactId: string; number: string | null; sequenceKey: string; sourceType: "order" | "quote" | "booking" | "subscription" | "manual" | "deposit" | "balance" | "tip" | "pay_what_you_want" | "late_fee" | "unlock" | "ad_campaign"; sourceId: string | null; idempotencyKey: string; requestHash: string; status: "draft" | "sent" | "viewed" | "partially_paid" | "paid" | "overdue" | "void" | "refunded"; currency: string; subtotalMinor: number; discountMinor: number; shippingMinor: number; taxMinor: number; taxZoneId: string | null; totalMinor: number; paidMinor: number; refundedMinor: number; billingAddress: unknown | null; customerTaxId: string | null; requiredTaxLegend: string | null; memo: string | null; schedule: unknown | null; depositOfInvoiceId: string | null; dueAt: string | null; issuedAt: string | null; viewedAt: string | null; paidAt: string | null; voidedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown } };
  };
  "invoicing.createPayment": {
    input: { invoiceId: string; provider: string; method: string; amountMinor: number; idempotencyKey: string; metadata?: { [key: string]: unknown } };
    output: { id: string; invoiceId: string; provider: string; providerCheckoutRef: string | null; providerRef: string | null; idempotencyKey: string; requestHash: string; status: "created" | "processing" | "succeeded" | "failed" | "cancelled"; method: string; currency: string; amountMinor: number; refundedMinor: number; failureCode: string | null; failureMessage: string | null; processedAt: string | null; failedAt: string | null; metadata: unknown; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "invoicing.createPaymentPlan": {
    input: { invoiceId: string; installments: { dueAt: string; amountMinor: number }[]; idempotencyKey: string };
    output: { plan: { id: string; invoiceId: string; idempotencyKey: string; requestHash: string; status: "active" | "completed" | "defaulted" | "cancelled"; currency: string; principalMinor: number; paidMinor: number; cancelledAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }; installments: { id: string; planId: string; position: number; dueAt: string; amountMinor: number; paidMinor: number; status: "scheduled" | "due" | "partially_paid" | "paid" | "waived" | "defaulted"; createdAt: string; updatedAt: string; [key: string]: unknown }[] };
  };
  "invoicing.createRefund": {
    input: { paymentId: string; amountMinor: number; idempotencyKey: string; reason: string };
    output: { id: string; paymentId: string; invoiceId: string; provider: string; providerRef: string | null; idempotencyKey: string; requestHash: string; status: "created" | "processing" | "succeeded" | "failed" | "cancelled"; currency: string; amountMinor: number; reason: string | null; failureCode: string | null; failureMessage: string | null; processedAt: string | null; failedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "invoicing.createSchedule": {
    input: { contactId: string; name: string; currency?: string; cadence?: "weekly" | "monthly" | "quarterly" | "yearly"; intervalCount?: number; lines: { description: string; quantityMicros?: number; unitAmountMinor: number }[]; memo?: string | null; dueInDays?: number; autoIssue?: boolean; startsOn?: string; endsOn?: string | null };
    output: { id: string; contactId: string; name: string; currency: string; cadence: "weekly" | "monthly" | "quarterly" | "yearly"; intervalCount: number; lines: unknown; memo: string | null; dueInDays: number; autoIssue: boolean; status: "active" | "paused" | "ended"; nextRunAt: string; endsOn: string | null; lastRunAt: string | null; lastInvoiceId: string | null; occurrences: number; [key: string]: unknown };
  };
  "invoicing.createTaxCategory": {
    input: { code: string; name: string; description?: string; defaultRateHintPpm?: number };
    output: { id: string; code: string; name: string; description: string | null; defaultRateHintPpm: number | null; active: boolean; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "invoicing.createTaxZone": {
    input: { name: string; country: string; regions?: string[]; postalPatterns?: string[]; priority?: number; basis?: "origin" | "destination"; pricesIncludeTax?: boolean; roundingScope?: "line" | "invoice"; roundingMode?: "half_up" | "bankers" };
    output: { id: string; name: string; templateKey: string | null; templateVersion: number | null; country: string; regions: string[]; postalPatterns: string[]; priority: number; basis: "origin" | "destination"; pricesIncludeTax: boolean; roundingScope: "line" | "invoice"; roundingMode: "half_up" | "bankers"; active: boolean; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "invoicing.failPayment": {
    input: { id: string; code?: string; message: string };
    output: { id: string; invoiceId: string; provider: string; providerCheckoutRef: string | null; providerRef: string | null; idempotencyKey: string; requestHash: string; status: "created" | "processing" | "succeeded" | "failed" | "cancelled"; method: string; currency: string; amountMinor: number; refundedMinor: number; failureCode: string | null; failureMessage: string | null; processedAt: string | null; failedAt: string | null; metadata: unknown; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "invoicing.failRefund": {
    input: { id: string; code?: string; message: string };
    output: { id: string; paymentId: string; invoiceId: string; provider: string; providerRef: string | null; idempotencyKey: string; requestHash: string; status: "created" | "processing" | "succeeded" | "failed" | "cancelled"; currency: string; amountMinor: number; reason: string | null; failureCode: string | null; failureMessage: string | null; processedAt: string | null; failedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "invoicing.get": {
    input: { id: string };
    output: { invoice: { id: string; contactId: string; number: string | null; sequenceKey: string; sourceType: "order" | "quote" | "booking" | "subscription" | "manual" | "deposit" | "balance" | "tip" | "pay_what_you_want" | "late_fee" | "unlock" | "ad_campaign"; sourceId: string | null; idempotencyKey: string; requestHash: string; status: "draft" | "sent" | "viewed" | "partially_paid" | "paid" | "overdue" | "void" | "refunded"; currency: string; subtotalMinor: number; discountMinor: number; shippingMinor: number; taxMinor: number; taxZoneId: string | null; totalMinor: number; paidMinor: number; refundedMinor: number; billingAddress: unknown | null; customerTaxId: string | null; requiredTaxLegend: string | null; memo: string | null; schedule: unknown | null; depositOfInvoiceId: string | null; dueAt: string | null; issuedAt: string | null; viewedAt: string | null; paidAt: string | null; voidedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }; lines: { id: string; invoiceId: string; position: number; sourceType: string | null; sourceId: string | null; description: string; quantityMicros: number; unitAmountMinor: number; subtotalMinor: number; discountMinor: number; taxMinor: number; totalMinor: number; taxCategoryCode: string; snapshot: unknown; createdAt: string; [key: string]: unknown }[]; taxLines: { id: string; invoiceId: string; invoiceLineId: string | null; kind: "item" | "shipping" | "exemption"; rateName: string; ratePpm: number; taxableMinor: number; amountMinor: number; jurisdiction: string; registrationNumber: string | null; inclusive: boolean; compound: boolean; priority: number; exemptionKind: string | null; explanation: string; createdAt: string; [key: string]: unknown }[]; payments: { id: string; invoiceId: string; provider: string; providerCheckoutRef: string | null; providerRef: string | null; idempotencyKey: string; requestHash: string; status: "created" | "processing" | "succeeded" | "failed" | "cancelled"; method: string; currency: string; amountMinor: number; refundedMinor: number; failureCode: string | null; failureMessage: string | null; processedAt: string | null; failedAt: string | null; metadata: unknown; createdAt: string; updatedAt: string; [key: string]: unknown }[]; refunds: { id: string; paymentId: string; invoiceId: string; provider: string; providerRef: string | null; idempotencyKey: string; requestHash: string; status: "created" | "processing" | "succeeded" | "failed" | "cancelled"; currency: string; amountMinor: number; reason: string | null; failureCode: string | null; failureMessage: string | null; processedAt: string | null; failedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[]; creditNotes: { id: string; invoiceId: string; number: string | null; sequenceKey: string; idempotencyKey: string; requestHash: string; status: "draft" | "issued" | "void"; currency: string; reason: string; subtotalMinor: number; taxMinor: number; totalMinor: number; issuedAt: string | null; voidedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[] };
  };
  "invoicing.getCustomerBalance": {
    input: { contactId: string; currency?: string; limit?: number };
    output: { accounts: { id: string; contactId: string; currency: string; balanceMinor: number; createdAt: string; updatedAt: string; [key: string]: unknown }[]; entries: { id: string; accountId: string; kind: "credit" | "debit" | "refund" | "adjustment"; deltaMinor: number; balanceAfterMinor: number; sourceType: string; sourceId: string | null; idempotencyKey: string; requestHash: string; reason: string; actor: string; createdAt: string; [key: string]: unknown }[] };
  };
  "invoicing.getPayment": {
    input: { id: string };
    output: { payment: { id: string; invoiceId: string; provider: string; providerCheckoutRef: string | null; providerRef: string | null; idempotencyKey: string; requestHash: string; status: "created" | "processing" | "succeeded" | "failed" | "cancelled"; method: string; currency: string; amountMinor: number; refundedMinor: number; failureCode: string | null; failureMessage: string | null; processedAt: string | null; failedAt: string | null; metadata: unknown; createdAt: string; updatedAt: string; [key: string]: unknown }; invoice: { id: string; contactId: string; number: string | null; sequenceKey: string; sourceType: "order" | "quote" | "booking" | "subscription" | "manual" | "deposit" | "balance" | "tip" | "pay_what_you_want" | "late_fee" | "unlock" | "ad_campaign"; sourceId: string | null; idempotencyKey: string; requestHash: string; status: "draft" | "sent" | "viewed" | "partially_paid" | "paid" | "overdue" | "void" | "refunded"; currency: string; subtotalMinor: number; discountMinor: number; shippingMinor: number; taxMinor: number; taxZoneId: string | null; totalMinor: number; paidMinor: number; refundedMinor: number; billingAddress: unknown | null; customerTaxId: string | null; requiredTaxLegend: string | null; memo: string | null; schedule: unknown | null; depositOfInvoiceId: string | null; dueAt: string | null; issuedAt: string | null; viewedAt: string | null; paidAt: string | null; voidedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown } };
  };
  "invoicing.getPaymentPlan": {
    input: { invoiceId: string };
    output: { plan: { id: string; invoiceId: string; idempotencyKey: string; requestHash: string; status: "active" | "completed" | "defaulted" | "cancelled"; currency: string; principalMinor: number; paidMinor: number; cancelledAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }; installments: { id: string; planId: string; position: number; dueAt: string; amountMinor: number; paidMinor: number; status: "scheduled" | "due" | "partially_paid" | "paid" | "waived" | "defaulted"; createdAt: string; updatedAt: string; [key: string]: unknown }[]; allocations: { id: string; paymentId: string; installmentId: string; amountMinor: number; createdAt: string; [key: string]: unknown }[] };
  };
  "invoicing.installTaxTemplate": {
    input: { key: string; pricesIncludeTax?: boolean; thresholdMinor?: number; thresholdCurrency?: string };
    output: { created: boolean; template: { key: string; version: number; group: "canada" | "european_union" | "united_kingdom" | "united_states" | "australia" | "new_zealand"; name: string; country: string; regions: string[]; basis: "origin" | "destination"; pricesIncludeTax: boolean; roundingScope: "line" | "invoice"; roundingMode: "half_up" | "bankers"; rates: { name: string; jurisdiction: string; ratePpm: number; appliesToShipping: boolean; priority?: number }[]; source: { authority: string; url: string; checkedOn: string }; activationLimitation: string | null }; zone: { id: string; name: string; templateKey: string | null; templateVersion: number | null; country: string; regions: string[]; postalPatterns: string[]; priority: number; basis: "origin" | "destination"; pricesIncludeTax: boolean; roundingScope: "line" | "invoice"; roundingMode: "half_up" | "bankers"; active: boolean; createdAt: string; updatedAt: string; [key: string]: unknown }; rates: { id: string; zoneId: string; categoryId: string | null; name: string; jurisdiction: string; ratePpm: number; compound: boolean; priority: number; appliesToShipping: boolean; effectiveFrom: string | null; effectiveTo: string | null; active: boolean; createdAt: string; updatedAt: string; [key: string]: unknown }[]; registration: { id: string; zoneId: string; number: string | null; scheme: "standard" | "oss" | "ioss" | "simplified"; collectsFrom: string | null; thresholdMinor: number; thresholdCurrency: string | null; status: "monitoring" | "active" | "paused" | "closed"; createdAt: string; updatedAt: string; [key: string]: unknown } | null };
  };
  "invoicing.issue": {
    input: { id: string; dueAt?: string };
    output: { invoice: { id: string; contactId: string; number: string | null; sequenceKey: string; sourceType: "order" | "quote" | "booking" | "subscription" | "manual" | "deposit" | "balance" | "tip" | "pay_what_you_want" | "late_fee" | "unlock" | "ad_campaign"; sourceId: string | null; idempotencyKey: string; requestHash: string; status: "draft" | "sent" | "viewed" | "partially_paid" | "paid" | "overdue" | "void" | "refunded"; currency: string; subtotalMinor: number; discountMinor: number; shippingMinor: number; taxMinor: number; taxZoneId: string | null; totalMinor: number; paidMinor: number; refundedMinor: number; billingAddress: unknown | null; customerTaxId: string | null; requiredTaxLegend: string | null; memo: string | null; schedule: unknown | null; depositOfInvoiceId: string | null; dueAt: string | null; issuedAt: string | null; viewedAt: string | null; paidAt: string | null; voidedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }; lines: { id: string; invoiceId: string; position: number; sourceType: string | null; sourceId: string | null; description: string; quantityMicros: number; unitAmountMinor: number; subtotalMinor: number; discountMinor: number; taxMinor: number; totalMinor: number; taxCategoryCode: string; snapshot: unknown; createdAt: string; [key: string]: unknown }[]; taxLines: { id: string; invoiceId: string; invoiceLineId: string | null; kind: "item" | "shipping" | "exemption"; rateName: string; ratePpm: number; taxableMinor: number; amountMinor: number; jurisdiction: string; registrationNumber: string | null; inclusive: boolean; compound: boolean; priority: number; exemptionKind: string | null; explanation: string; createdAt: string; [key: string]: unknown }[]; payments: { id: string; invoiceId: string; provider: string; providerCheckoutRef: string | null; providerRef: string | null; idempotencyKey: string; requestHash: string; status: "created" | "processing" | "succeeded" | "failed" | "cancelled"; method: string; currency: string; amountMinor: number; refundedMinor: number; failureCode: string | null; failureMessage: string | null; processedAt: string | null; failedAt: string | null; metadata: unknown; createdAt: string; updatedAt: string; [key: string]: unknown }[]; refunds: { id: string; paymentId: string; invoiceId: string; provider: string; providerRef: string | null; idempotencyKey: string; requestHash: string; status: "created" | "processing" | "succeeded" | "failed" | "cancelled"; currency: string; amountMinor: number; reason: string | null; failureCode: string | null; failureMessage: string | null; processedAt: string | null; failedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[]; creditNotes: { id: string; invoiceId: string; number: string | null; sequenceKey: string; idempotencyKey: string; requestHash: string; status: "draft" | "issued" | "void"; currency: string; reason: string; subtotalMinor: number; taxMinor: number; totalMinor: number; issuedAt: string | null; voidedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[] };
  };
  "invoicing.issueCreditNote": {
    input: { id: string };
    output: { id: string; invoiceId: string; number: string | null; sequenceKey: string; idempotencyKey: string; requestHash: string; status: "draft" | "issued" | "void"; currency: string; reason: string; subtotalMinor: number; taxMinor: number; totalMinor: number; issuedAt: string | null; voidedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "invoicing.list": {
    input: { contactId?: string; status?: "draft" | "sent" | "viewed" | "partially_paid" | "paid" | "overdue" | "void" | "refunded"; limit?: number };
    output: { id: string; contactId: string; number: string | null; sequenceKey: string; sourceType: "order" | "quote" | "booking" | "subscription" | "manual" | "deposit" | "balance" | "tip" | "pay_what_you_want" | "late_fee" | "unlock" | "ad_campaign"; sourceId: string | null; idempotencyKey: string; requestHash: string; status: "draft" | "sent" | "viewed" | "partially_paid" | "paid" | "overdue" | "void" | "refunded"; currency: string; subtotalMinor: number; discountMinor: number; shippingMinor: number; taxMinor: number; taxZoneId: string | null; totalMinor: number; paidMinor: number; refundedMinor: number; billingAddress: unknown | null; customerTaxId: string | null; requiredTaxLegend: string | null; memo: string | null; schedule: unknown | null; depositOfInvoiceId: string | null; dueAt: string | null; issuedAt: string | null; viewedAt: string | null; paidAt: string | null; voidedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "invoicing.listInPersonPayments": {
    input: { limit?: number };
    output: { id: string; invoiceId: string; provider: string; providerCheckoutRef: string | null; providerRef: string | null; idempotencyKey: string; requestHash: string; status: "created" | "processing" | "succeeded" | "failed" | "cancelled"; method: string; currency: string; amountMinor: number; refundedMinor: number; failureCode: string | null; failureMessage: string | null; processedAt: string | null; failedAt: string | null; metadata: unknown; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "invoicing.listPaymentDisputes": {
    input: { status?: "open" | "won" | "lost"; limit?: number };
    output: { id: string; paymentId: string; invoiceId: string; provider: string; providerRef: string; providerPaymentRef: string; status: "open" | "won" | "lost"; currency: string; amountMinor: number; reason: string | null; evidenceDueAt: string | null; openedAt: string; providerStatusAt: string; closedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "invoicing.listPaymentProviders": {
    input: { country: string; currency: string; recurring?: boolean };
    output: { id: string; status: { family: string; id: string; available: boolean; message: string }; capabilities: { refunds: boolean; partialRefunds: boolean; savedMethods: boolean; subscriptions: boolean; offSessionCharges: boolean; disputes: boolean; payouts: boolean; inPerson: boolean; strongCustomerAuthentication: boolean }; methods: { id: string; label: string; kind: "card" | "wallet" | "bank_debit" | "bank_redirect" | "buy_now_pay_later" | "cash" | "bank_transfer" | "other"; recurring: boolean }[]; currencySupport: string; selected: boolean }[];
  };
  "invoicing.listPayments": {
    input: { invoiceId?: string; provider?: "manual" | "balance" | "stripe" | "paypal" | "square" | "mollie" | "razorpay" | "paystack" | "flutterwave"; status?: "created" | "processing" | "succeeded" | "failed" | "cancelled"; limit?: number };
    output: { payment: { id: string; invoiceId: string; provider: string; providerCheckoutRef: string | null; providerRef: string | null; idempotencyKey: string; requestHash: string; status: "created" | "processing" | "succeeded" | "failed" | "cancelled"; method: string; currency: string; amountMinor: number; refundedMinor: number; failureCode: string | null; failureMessage: string | null; processedAt: string | null; failedAt: string | null; metadata: unknown; createdAt: string; updatedAt: string; [key: string]: unknown }; invoiceNumber: string | null; contactId: string }[];
  };
  "invoicing.listPointOfSale": {
    input: Record<string, never>;
    output: { id: string; status: { family: string; id: string; available: boolean; message: string }; capabilities: { countertop: boolean; tapToPay: boolean; cashRecording: boolean; refunds: boolean } }[];
  };
  "invoicing.listProviderPayouts": {
    input: { provider?: "stripe" | "paypal" | "square" | "mollie" | "razorpay" | "paystack" | "flutterwave"; status?: "pending" | "in_transit" | "paid" | "failed" | "cancelled"; reconciled?: boolean; limit?: number };
    output: { payout: { id: string; provider: string; providerRef: string; status: "pending" | "in_transit" | "paid" | "failed" | "cancelled"; currency: string; amountMinor: number; statementRef: string | null; failureReason: string | null; expectedAt: string | null; providerStatusAt: string; paidAt: string | null; reconciledAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }; transactions: { id: string; provider: string; providerRef: string; kind: "charge" | "refund" | "dispute" | "fee" | "adjustment" | "reserve" | "release"; sourceType: string | null; sourceId: string | null; currency: string; grossMinor: number; feeMinor: number; netMinor: number; availableAt: string | null; occurredAt: string; metadata: unknown; requestHash: string; createdAt: string; [key: string]: unknown }[]; matchedNetMinor: number }[];
  };
  "invoicing.listSavedPaymentMethods": {
    input: { contactId?: string; includeRevoked?: boolean; limit?: number };
    output: { id: string; contactId: string; provider: string; kind: "card" | "wallet" | "bank_debit" | "bank_redirect" | "buy_now_pay_later" | "cash" | "bank_transfer" | "other"; label: string; brand: string | null; last4: string | null; expiryMonth: number | null; expiryYear: number | null; status: "active" | "revoked" | "expired"; consentedAt: string; revokedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "invoicing.listSchedules": {
    input: { status?: "active" | "paused" | "ended" };
    output: { id: string; contactId: string; name: string; currency: string; cadence: "weekly" | "monthly" | "quarterly" | "yearly"; intervalCount: number; lines: unknown; memo: string | null; dueInDays: number; autoIssue: boolean; status: "active" | "paused" | "ended"; nextRunAt: string; endsOn: string | null; lastRunAt: string | null; lastInvoiceId: string | null; occurrences: number; contactName: string | null; [key: string]: unknown }[];
  };
  "invoicing.listTaxTemplates": {
    input: { group?: "canada" | "european_union" | "united_kingdom" | "united_states" | "australia" | "new_zealand" };
    output: { templates: { key: string; version: number; group: "canada" | "european_union" | "united_kingdom" | "united_states" | "australia" | "new_zealand"; name: string; country: string; regions: string[]; basis: "origin" | "destination"; pricesIncludeTax: boolean; roundingScope: "line" | "invoice"; roundingMode: "half_up" | "bankers"; rates: { name: string; jurisdiction: string; ratePpm: number; appliesToShipping: boolean; priority?: number }[]; source: { authority: string; url: string; checkedOn: string }; activationLimitation: string | null }[]; warning: string };
  };
  "invoicing.loadDemoFixture": {
    input: { scenarioKey: string; scenarioVersion: number; runId: string; generation: number; locale: string; records?: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
    output: { records: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
  };
  "invoicing.markOverdue": {
    input: { id: string; asOf?: string };
    output: { id: string; contactId: string; number: string | null; sequenceKey: string; sourceType: "order" | "quote" | "booking" | "subscription" | "manual" | "deposit" | "balance" | "tip" | "pay_what_you_want" | "late_fee" | "unlock" | "ad_campaign"; sourceId: string | null; idempotencyKey: string; requestHash: string; status: "draft" | "sent" | "viewed" | "partially_paid" | "paid" | "overdue" | "void" | "refunded"; currency: string; subtotalMinor: number; discountMinor: number; shippingMinor: number; taxMinor: number; taxZoneId: string | null; totalMinor: number; paidMinor: number; refundedMinor: number; billingAddress: unknown | null; customerTaxId: string | null; requiredTaxLegend: string | null; memo: string | null; schedule: unknown | null; depositOfInvoiceId: string | null; dueAt: string | null; issuedAt: string | null; viewedAt: string | null; paidAt: string | null; voidedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "invoicing.markOverdueSweep": {
    input: Record<string, never>;
    output: { overdue: number; [key: string]: unknown };
  };
  "invoicing.markViewed": {
    input: { id: string };
    output: { id: string; contactId: string; number: string | null; sequenceKey: string; sourceType: "order" | "quote" | "booking" | "subscription" | "manual" | "deposit" | "balance" | "tip" | "pay_what_you_want" | "late_fee" | "unlock" | "ad_campaign"; sourceId: string | null; idempotencyKey: string; requestHash: string; status: "draft" | "sent" | "viewed" | "partially_paid" | "paid" | "overdue" | "void" | "refunded"; currency: string; subtotalMinor: number; discountMinor: number; shippingMinor: number; taxMinor: number; taxZoneId: string | null; totalMinor: number; paidMinor: number; refundedMinor: number; billingAddress: unknown | null; customerTaxId: string | null; requiredTaxLegend: string | null; memo: string | null; schedule: unknown | null; depositOfInvoiceId: string | null; dueAt: string | null; issuedAt: string | null; viewedAt: string | null; paidAt: string | null; voidedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "invoicing.processPaymentProviderEvents": {
    input: { provider: "stripe" | "paypal" | "square" | "mollie" | "razorpay" | "paystack" | "flutterwave"; bodySha256: string; receivedAt: string; events: ({ id: string; kind: "payment_processing" | "payment_succeeded" | "payment_failed" | "payment_cancelled"; providerRef: string; checkoutRef?: string; amountMinor?: number; currency?: string; occurredAt: string; invoiceId?: string; contactId?: string; providerCustomerRef?: string; savedMethod?: { providerRef: string; providerCustomerRef?: string; kind: "card" | "wallet" | "bank_debit" | "bank_redirect" | "buy_now_pay_later" | "cash" | "bank_transfer" | "other"; label: string; brand?: string; last4?: string; expiryMonth?: number; expiryYear?: number } } | { id: string; kind: "refund_processing" | "refund_succeeded" | "refund_failed"; providerRef: string; paymentProviderRef: string; amountMinor?: number; currency?: string; occurredAt: string } | { id: string; kind: "dispute_opened" | "dispute_won" | "dispute_lost"; providerRef: string; paymentProviderRef: string; amountMinor?: number; currency?: string; occurredAt: string; reason?: string; evidenceDueAt?: string } | { id: string; kind: "saved_method_added" | "saved_method_removed"; providerCustomerRef?: string; contactId?: string; method: { providerRef: string; providerCustomerRef?: string; kind: "card" | "wallet" | "bank_debit" | "bank_redirect" | "buy_now_pay_later" | "cash" | "bank_transfer" | "other"; label: string; brand?: string; last4?: string; expiryMonth?: number; expiryYear?: number }; occurredAt: string } | { id: string; kind: "payout_pending" | "payout_in_transit" | "payout_paid" | "payout_failed" | "payout_cancelled"; providerRef: string; amountMinor: number; currency: string; occurredAt: string; expectedAt?: string; statementRef?: string; failureReason?: string } | { id: string; kind: "subscription_period_paid" | "subscription_period_failed" | "subscription_cancelled"; providerRef: string; occurredAt: string; amountMinor?: number; currency?: string; periodStart?: string; periodEnd?: string; invoiceProviderRef?: string })[] };
    output: { processed: number; duplicates: number };
  };
  "invoicing.purgeDemoFixture": {
    input: { scenarioKey: string; scenarioVersion: number; runId: string; generation: number; locale: string; records?: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
    output: { purged: { subjectType: string; subjectId: string }[] };
  };
  "invoicing.quoteTax": {
    input: { currency: string; origin: { country: string; region?: string; postalCode?: string; city?: string }; destination: { country: string; region?: string; postalCode?: string; city?: string }; contactId?: string; items: { id: string; quantityMicros: number; unitAmountMinor: number; discountMinor?: number; category?: string; requiresShipping?: boolean }[]; shippingMinor?: number; occurredAt?: string };
    output: { provider: string; currency: string; lines: { itemId?: string; jurisdiction: string; name: string; ratePartsPerMillion: number; taxableMinor: number; taxMinor: number; inclusive: boolean; compound: boolean; priority: number }[]; totalTaxMinor: number; includedTaxMinor: number; explanation: string[]; zone: { id: string; name: string } | null; registration: { id: string; number: string | null } | null; exemption: { id: string; kind: string } | null };
  };
  "invoicing.receipt": {
    input: { paymentId: string };
    output: { receiptNumber: string; issuedAt: string; invoice: { id: string; number: string; issuedAt: string; currency: string; totalMinor: number }; customer: { id: string; name: string | null; email: string | null }; payment: { id: string; provider: string; providerRef: string; method: string; amountMinor: number; refundedMinor: number; netMinor: number }; lines: { id: string; invoiceId: string; position: number; sourceType: string | null; sourceId: string | null; description: string; quantityMicros: number; unitAmountMinor: number; subtotalMinor: number; discountMinor: number; taxMinor: number; totalMinor: number; taxCategoryCode: string; snapshot: unknown; createdAt: string; [key: string]: unknown }[]; taxLines: { id: string; invoiceId: string; invoiceLineId: string | null; kind: "item" | "shipping" | "exemption"; rateName: string; ratePpm: number; taxableMinor: number; amountMinor: number; jurisdiction: string; registrationNumber: string | null; inclusive: boolean; compound: boolean; priority: number; exemptionKind: string | null; explanation: string; createdAt: string; [key: string]: unknown }[]; refunds: { id: string; paymentId: string; invoiceId: string; provider: string; providerRef: string | null; idempotencyKey: string; requestHash: string; status: "created" | "processing" | "succeeded" | "failed" | "cancelled"; currency: string; amountMinor: number; reason: string | null; failureCode: string | null; failureMessage: string | null; processedAt: string | null; failedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[]; requiredTaxLegend: string | null };
  };
  "invoicing.reconcileAdvancedMoney": {
    input: { limit?: number };
    output: { balanced: boolean; checked: { customerBalances: number; paymentPlans: number; providerPayouts: number }; discrepancies: { subjectType: "customer_balance" | "payment_plan" | "provider_payout"; subjectId: string; recordedMinor: number; calculatedMinor: number }[]; unassignedProviderLines: { id: string; provider: string; providerRef: string; kind: "charge" | "refund" | "dispute" | "fee" | "adjustment" | "reserve" | "release"; sourceType: string | null; sourceId: string | null; currency: string; grossMinor: number; feeMinor: number; netMinor: number; availableAt: string | null; occurredAt: string; metadata: unknown; requestHash: string; createdAt: string; [key: string]: unknown }[] };
  };
  "invoicing.reconcileInPersonPayments": {
    input: Record<string, never>;
    output: { balanced: boolean; unsettled: { id: string; invoiceId: string; provider: string; providerCheckoutRef: string | null; providerRef: string | null; idempotencyKey: string; requestHash: string; status: "created" | "processing" | "succeeded" | "failed" | "cancelled"; method: string; currency: string; amountMinor: number; refundedMinor: number; failureCode: string | null; failureMessage: string | null; processedAt: string | null; failedAt: string | null; metadata: unknown; createdAt: string; updatedAt: string; [key: string]: unknown }[]; succeeded: number; methods: ("cash" | "card_present" | "tap_to_pay")[] };
  };
  "invoicing.reconcilePaymentProviders": {
    input: { provider?: "stripe" | "paypal" | "square" | "mollie" | "razorpay" | "paystack" | "flutterwave"; limit?: number };
    output: { unsettled: { id: string; invoiceId: string; provider: string; providerCheckoutRef: string | null; providerRef: string | null; idempotencyKey: string; requestHash: string; status: "created" | "processing" | "succeeded" | "failed" | "cancelled"; method: string; currency: string; amountMinor: number; refundedMinor: number; failureCode: string | null; failureMessage: string | null; processedAt: string | null; failedAt: string | null; metadata: unknown; createdAt: string; updatedAt: string; [key: string]: unknown }[]; openDisputes: { id: string; paymentId: string; invoiceId: string; provider: string; providerRef: string; providerPaymentRef: string; status: "open" | "won" | "lost"; currency: string; amountMinor: number; reason: string | null; evidenceDueAt: string | null; openedAt: string; providerStatusAt: string; closedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[]; payouts: { id: string; provider: string; providerRef: string; status: "pending" | "in_transit" | "paid" | "failed" | "cancelled"; currency: string; amountMinor: number; statementRef: string | null; failureReason: string | null; expectedAt: string | null; providerStatusAt: string; paidAt: string | null; reconciledAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[]; balanceTransactions: { id: string; provider: string; providerRef: string; kind: "charge" | "refund" | "dispute" | "fee" | "adjustment" | "reserve" | "release"; sourceType: string | null; sourceId: string | null; currency: string; grossMinor: number; feeMinor: number; netMinor: number; availableAt: string | null; occurredAt: string; metadata: unknown; requestHash: string; createdAt: string; [key: string]: unknown }[]; events: { id: string; provider: string; providerEventId: string; kind: string; providerObjectRef: string | null; bodySha256: string; status: "processed" | "ignored"; detail: string | null; occurredAt: string; receivedAt: string; processedAt: string; [key: string]: unknown }[] };
  };
  "invoicing.reconcileProviderPayout": {
    input: { payoutId: string; balanceTransactionIds: string[] };
    output: { payout: { id: string; provider: string; providerRef: string; status: "pending" | "in_transit" | "paid" | "failed" | "cancelled"; currency: string; amountMinor: number; statementRef: string | null; failureReason: string | null; expectedAt: string | null; providerStatusAt: string; paidAt: string | null; reconciledAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }; transactions: { id: string; provider: string; providerRef: string; kind: "charge" | "refund" | "dispute" | "fee" | "adjustment" | "reserve" | "release"; sourceType: string | null; sourceId: string | null; currency: string; grossMinor: number; feeMinor: number; netMinor: number; availableAt: string | null; occurredAt: string; metadata: unknown; requestHash: string; createdAt: string; [key: string]: unknown }[]; netMinor: number };
  };
  "invoicing.reconciliation": {
    input: { limit?: number };
    output: { balanced: boolean; checked: { invoices: number; payments: number; refunds: number }; discrepancies: { subjectType: "invoice" | "payment"; subjectId: string; field: string; recordedMinor: number; calculatedMinor: number }[] };
  };
  "invoicing.recordOfflinePayment": {
    input: { invoiceId: string; method: "cash" | "bank_transfer" | "cheque" | "external_card" | "other"; amountMinor: number; reference?: string; evidence: string; processedAt?: string; idempotencyKey: string };
    output: { id: string; invoiceId: string; provider: string; providerCheckoutRef: string | null; providerRef: string | null; idempotencyKey: string; requestHash: string; status: "created" | "processing" | "succeeded" | "failed" | "cancelled"; method: string; currency: string; amountMinor: number; refundedMinor: number; failureCode: string | null; failureMessage: string | null; processedAt: string | null; failedAt: string | null; metadata: unknown; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "invoicing.recordOfflineRefund": {
    input: { paymentId: string; amountMinor: number; reason: string; reference?: string; processedAt?: string; idempotencyKey: string };
    output: { id: string; paymentId: string; invoiceId: string; provider: string; providerRef: string | null; idempotencyKey: string; requestHash: string; status: "created" | "processing" | "succeeded" | "failed" | "cancelled"; currency: string; amountMinor: number; reason: string | null; failureCode: string | null; failureMessage: string | null; processedAt: string | null; failedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "invoicing.recordProviderBalanceTransaction": {
    input: { provider: "stripe" | "paypal" | "square" | "mollie" | "razorpay" | "paystack" | "flutterwave"; providerRef: string; kind: "charge" | "refund" | "dispute" | "fee" | "adjustment" | "reserve" | "release"; sourceType?: "payment" | "refund" | "dispute"; sourceId?: string; currency: string; grossMinor: number; feeMinor: number; availableAt?: string; occurredAt: string; metadata?: { [key: string]: unknown } };
    output: { id: string; provider: string; providerRef: string; kind: "charge" | "refund" | "dispute" | "fee" | "adjustment" | "reserve" | "release"; sourceType: string | null; sourceId: string | null; currency: string; grossMinor: number; feeMinor: number; netMinor: number; availableAt: string | null; occurredAt: string; metadata: unknown; requestHash: string; createdAt: string; [key: string]: unknown };
  };
  "invoicing.recordProviderPayout": {
    input: { provider: "stripe" | "paypal" | "square" | "mollie" | "razorpay" | "paystack" | "flutterwave"; providerRef: string; status: "pending" | "in_transit" | "paid" | "failed" | "cancelled"; currency: string; amountMinor: number; occurredAt: string; expectedAt?: string; statementRef?: string; failureReason?: string };
    output: { payout: { id: string; provider: string; providerRef: string; status: "pending" | "in_transit" | "paid" | "failed" | "cancelled"; currency: string; amountMinor: number; statementRef: string | null; failureReason: string | null; expectedAt: string | null; providerStatusAt: string; paidAt: string | null; reconciledAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }; applied: boolean };
  };
  "invoicing.refreshPaymentPlans": {
    input: { asOf?: string; limit?: number };
    output: { checked: number; changed: number; asOf: string };
  };
  "invoicing.refundCustomerBalancePayment": {
    input: { paymentId: string; amountMinor: number; reason: string; idempotencyKey: string };
    output: { refund: { id: string; paymentId: string; invoiceId: string; provider: string; providerRef: string | null; idempotencyKey: string; requestHash: string; status: "created" | "processing" | "succeeded" | "failed" | "cancelled"; currency: string; amountMinor: number; reason: string | null; failureCode: string | null; failureMessage: string | null; processedAt: string | null; failedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }; account: { id: string; contactId: string; currency: string; balanceMinor: number; createdAt: string; updatedAt: string; [key: string]: unknown }; entry?: { id: string; accountId: string; kind: "credit" | "debit" | "refund" | "adjustment"; deltaMinor: number; balanceAfterMinor: number; sourceType: string; sourceId: string | null; idempotencyKey: string; requestHash: string; reason: string; actor: string; createdAt: string; [key: string]: unknown } };
  };
  "invoicing.refundInPersonPayment": {
    input: { paymentId: string; amountMinor: number; reason: string; idempotencyKey: string };
    output: { id: string; paymentId: string; invoiceId: string; provider: string; providerRef: string | null; idempotencyKey: string; requestHash: string; status: "created" | "processing" | "succeeded" | "failed" | "cancelled"; currency: string; amountMinor: number; reason: string | null; failureCode: string | null; failureMessage: string | null; processedAt: string | null; failedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "invoicing.reminders": {
    input: { invoiceId: string };
    output: { id: string; offsetDays: number; sendAt: string; sentAt: string | null; status: "scheduled" | "sent" | "skipped" | "failed"; skipReason: string | null; [key: string]: unknown }[];
  };
  "invoicing.revokeSavedPaymentMethod": {
    input: { id: string; idempotencyKey: string };
    output: { id: string; contactId: string; provider: string; providerMethodRef: string; providerCustomerRef: string | null; kind: "card" | "wallet" | "bank_debit" | "bank_redirect" | "buy_now_pay_later" | "cash" | "bank_transfer" | "other"; label: string; brand: string | null; last4: string | null; expiryMonth: number | null; expiryYear: number | null; status: "active" | "revoked" | "expired"; consentSource: string; consentedAt: string; providerStatusAt: string; revokedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "invoicing.runSchedules": {
    input: Record<string, never>;
    output: { raised: number; issued: number; ended: number; [key: string]: unknown };
  };
  "invoicing.scheduleReminders": {
    input: { invoiceId: string; offsetDays: number[] };
    output: { id: string; offsetDays: number; sendAt: string; status: "scheduled" | "sent" | "skipped" | "failed"; [key: string]: unknown }[];
  };
  "invoicing.setTaxExemption": {
    input: { id?: string; contactId: string; zoneId: string; kind: "reseller" | "nonprofit" | "reverse_charge" | "diplomatic"; certificateRef?: string; validatedAt?: string; expiresAt?: string; status: "pending" | "valid" | "expired" | "revoked" };
    output: { id: string; contactId: string; zoneId: string; kind: "reseller" | "nonprofit" | "reverse_charge" | "diplomatic"; certificateRef: string | null; validatedAt: string | null; expiresAt: string | null; status: "pending" | "valid" | "expired" | "revoked"; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "invoicing.setTaxRegistration": {
    input: { id?: string; zoneId: string; number?: string | null; scheme?: "standard" | "oss" | "ioss" | "simplified"; collectsFrom?: string; thresholdMinor?: number; thresholdCurrency?: string; status: "monitoring" | "active" | "paused" | "closed"; acknowledgeTemplateLimitations?: boolean };
    output: { id: string; zoneId: string; number: string | null; scheme: "standard" | "oss" | "ioss" | "simplified"; collectsFrom: string | null; thresholdMinor: number; thresholdCurrency: string | null; status: "monitoring" | "active" | "paused" | "closed"; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "invoicing.settlePayment": {
    input: { id: string; providerRef: string; processedAt?: string };
    output: { id: string; invoiceId: string; provider: string; providerCheckoutRef: string | null; providerRef: string | null; idempotencyKey: string; requestHash: string; status: "created" | "processing" | "succeeded" | "failed" | "cancelled"; method: string; currency: string; amountMinor: number; refundedMinor: number; failureCode: string | null; failureMessage: string | null; processedAt: string | null; failedAt: string | null; metadata: unknown; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "invoicing.settleRefund": {
    input: { id: string; providerRef: string; processedAt?: string };
    output: { id: string; paymentId: string; invoiceId: string; provider: string; providerRef: string | null; idempotencyKey: string; requestHash: string; status: "created" | "processing" | "succeeded" | "failed" | "cancelled"; currency: string; amountMinor: number; reason: string | null; failureCode: string | null; failureMessage: string | null; processedAt: string | null; failedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "invoicing.startPayment": {
    input: { id: string; providerRef?: string; providerCheckoutRef?: string };
    output: { id: string; invoiceId: string; provider: string; providerCheckoutRef: string | null; providerRef: string | null; idempotencyKey: string; requestHash: string; status: "created" | "processing" | "succeeded" | "failed" | "cancelled"; method: string; currency: string; amountMinor: number; refundedMinor: number; failureCode: string | null; failureMessage: string | null; processedAt: string | null; failedAt: string | null; metadata: unknown; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "invoicing.startRefund": {
    input: { id: string; providerRef?: string };
    output: { id: string; paymentId: string; invoiceId: string; provider: string; providerRef: string | null; idempotencyKey: string; requestHash: string; status: "created" | "processing" | "succeeded" | "failed" | "cancelled"; currency: string; amountMinor: number; reason: string | null; failureCode: string | null; failureMessage: string | null; processedAt: string | null; failedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "invoicing.submitProviderRefund": {
    input: { paymentId: string; amountMinor: number; reason: string; idempotencyKey: string };
    output: { id: string; paymentId: string; invoiceId: string; provider: string; providerRef: string | null; idempotencyKey: string; requestHash: string; status: "created" | "processing" | "succeeded" | "failed" | "cancelled"; currency: string; amountMinor: number; reason: string | null; failureCode: string | null; failureMessage: string | null; processedAt: string | null; failedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "invoicing.taxConfiguration": {
    input: Record<string, never>;
    output: { categories: { id: string; code: string; name: string; description: string | null; defaultRateHintPpm: number | null; active: boolean; createdAt: string; updatedAt: string; [key: string]: unknown }[]; zones: { id: string; name: string; templateKey: string | null; templateVersion: number | null; country: string; regions: string[]; postalPatterns: string[]; priority: number; basis: "origin" | "destination"; pricesIncludeTax: boolean; roundingScope: "line" | "invoice"; roundingMode: "half_up" | "bankers"; active: boolean; createdAt: string; updatedAt: string; [key: string]: unknown }[]; rates: { id: string; zoneId: string; categoryId: string | null; name: string; jurisdiction: string; ratePpm: number; compound: boolean; priority: number; appliesToShipping: boolean; effectiveFrom: string | null; effectiveTo: string | null; active: boolean; createdAt: string; updatedAt: string; [key: string]: unknown }[]; registrations: { id: string; zoneId: string; number: string | null; scheme: "standard" | "oss" | "ioss" | "simplified"; collectsFrom: string | null; thresholdMinor: number; thresholdCurrency: string | null; status: "monitoring" | "active" | "paused" | "closed"; createdAt: string; updatedAt: string; [key: string]: unknown }[]; exemptions: { id: string; contactId: string; zoneId: string; kind: "reseller" | "nonprofit" | "reverse_charge" | "diplomatic"; certificateRef: string | null; validatedAt: string | null; expiresAt: string | null; status: "pending" | "valid" | "expired" | "revoked"; createdAt: string; updatedAt: string; [key: string]: unknown }[] };
  };
  "invoicing.taxThresholds": {
    input: { asOf?: string; window?: "calendar_year" | "rolling_12_months" };
    output: { thresholds: { zone: { id: string; name: string; country: string }; registration: { id: string; status: "monitoring" | "active" | "paused" | "closed"; thresholdMinor: number; thresholdCurrency: string | null }; window: "calendar_year" | "rolling_12_months"; startsAt: string; endsAt: string; state: "not_configured" | "reached" | "approaching" | "below"; grossSalesMinor: number; refundsMinor: number; netSalesMinor: number; transactions: number; remainingMinor: number; progressPpm: number; totalsByCurrency: { currency: string; grossSalesMinor: number; refundsMinor: number; transactions: number }[]; explanation: string }[] };
  };
  "invoicing.updateSchedule": {
    input: { id: string; name?: string; lines?: { description: string; quantityMicros?: number; unitAmountMinor: number }[]; memo?: string | null; dueInDays?: number; autoIssue?: boolean; status?: "active" | "paused" | "ended"; endsOn?: string | null };
    output: { id: string; contactId: string; name: string; currency: string; cadence: "weekly" | "monthly" | "quarterly" | "yearly"; intervalCount: number; lines: unknown; memo: string | null; dueInDays: number; autoIssue: boolean; status: "active" | "paused" | "ended"; nextRunAt: string; endsOn: string | null; lastRunAt: string | null; lastInvoiceId: string | null; occurrences: number; [key: string]: unknown };
  };
  "invoicing.verifyDemoFixture": {
    input: { scenarioKey: string; scenarioVersion: number; runId: string; generation: number; locale: string; records?: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
    output: { outcomes: { key: string; achieved: boolean; detail?: string }[] };
  };
  "invoicing.void": {
    input: { id: string; reason: string };
    output: { id: string; contactId: string; number: string | null; sequenceKey: string; sourceType: "order" | "quote" | "booking" | "subscription" | "manual" | "deposit" | "balance" | "tip" | "pay_what_you_want" | "late_fee" | "unlock" | "ad_campaign"; sourceId: string | null; idempotencyKey: string; requestHash: string; status: "draft" | "sent" | "viewed" | "partially_paid" | "paid" | "overdue" | "void" | "refunded"; currency: string; subtotalMinor: number; discountMinor: number; shippingMinor: number; taxMinor: number; taxZoneId: string | null; totalMinor: number; paidMinor: number; refundedMinor: number; billingAddress: unknown | null; customerTaxId: string | null; requiredTaxLegend: string | null; memo: string | null; schedule: unknown | null; depositOfInvoiceId: string | null; dueAt: string | null; issuedAt: string | null; viewedAt: string | null; paidAt: string | null; voidedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "invoicing.voidCreditNote": {
    input: { id: string; reason: string };
    output: { id: string; invoiceId: string; number: string | null; sequenceKey: string; idempotencyKey: string; requestHash: string; status: "draft" | "issued" | "void"; currency: string; reason: string; subtotalMinor: number; taxMinor: number; totalMinor: number; issuedAt: string | null; voidedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "locations.create": {
    input: { name: string; slug: string; schemaType?: string | null; street?: string | null; unit?: string | null; city?: string | null; region?: string | null; postalCode?: string | null; country: string; latitude?: number | null; longitude?: number | null; phone?: string | null; email?: string | null; googleBusinessProfileUrl?: string | null; sameAs?: string[]; priceRange?: string | null; timezone?: string | null; status?: "visible" | "hidden"; isPrimary?: boolean };
    output: { id: string; name: string; slug: string; isPrimary: boolean; schemaType: string | null; street: string | null; unit: string | null; city: string | null; region: string | null; postalCode: string | null; country: string; latitude: string | null; longitude: string | null; phone: string | null; email: string | null; googleBusinessProfileUrl: string | null; sameAs: string[]; priceRange: string | null; timezone: string | null; status: "visible" | "hidden"; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "locations.createSetupLocation": {
    input: { name: string; slug: string; schemaType?: string | null; street?: string | null; unit?: string | null; city?: string | null; region?: string | null; postalCode?: string | null; country: string; latitude?: number | null; longitude?: number | null; phone?: string | null; email?: string | null; googleBusinessProfileUrl?: string | null; sameAs?: string[]; priceRange?: string | null; timezone?: string | null; status?: "visible" | "hidden"; isPrimary?: boolean };
    output: { id: string; name: string; slug: string; isPrimary: boolean; schemaType: string | null; street: string | null; unit: string | null; city: string | null; region: string | null; postalCode: string | null; country: string; latitude: string | null; longitude: string | null; phone: string | null; email: string | null; googleBusinessProfileUrl: string | null; sameAs: string[]; priceRange: string | null; timezone: string | null; status: "visible" | "hidden"; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "locations.get": {
    input: { id?: string; slug?: string };
    output: { id: string; name: string; slug: string; isPrimary: boolean; schemaType: string | null; street: string | null; unit: string | null; city: string | null; region: string | null; postalCode: string | null; country: string; latitude: string | null; longitude: string | null; phone: string | null; email: string | null; googleBusinessProfileUrl: string | null; sameAs: string[]; priceRange: string | null; timezone: string | null; status: "visible" | "hidden"; createdAt: string; updatedAt: string; hours: { id: string; locationId: string; weekday: number | null; onDate: string | null; opens: string | null; closes: string | null; closed: boolean; label: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[]; serviceArea: { id: string; locationId: string; kind: "radius" | "regions"; centerLatitude: string | null; centerLongitude: string | null; radiusKm: string | null; regions: string[]; createdAt: string; updatedAt: string; [key: string]: unknown } | null; [key: string]: unknown } | null;
  };
  "locations.list": {
    input: { includeHidden?: boolean };
    output: { id: string; name: string; slug: string; isPrimary: boolean; schemaType: string | null; street: string | null; unit: string | null; city: string | null; region: string | null; postalCode: string | null; country: string; latitude: string | null; longitude: string | null; phone: string | null; email: string | null; googleBusinessProfileUrl: string | null; sameAs: string[]; priceRange: string | null; timezone: string | null; status: "visible" | "hidden"; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "locations.primary": {
    input: Record<string, never>;
    output: { id: string; name: string; slug: string; isPrimary: boolean; schemaType: string | null; street: string | null; unit: string | null; city: string | null; region: string | null; postalCode: string | null; country: string; latitude: string | null; longitude: string | null; phone: string | null; email: string | null; googleBusinessProfileUrl: string | null; sameAs: string[]; priceRange: string | null; timezone: string | null; status: "visible" | "hidden"; createdAt: string; updatedAt: string; [key: string]: unknown } | null;
  };
  "locations.remove": {
    input: { id: string };
    output: { id: string; slug: string };
  };
  "locations.setHours": {
    input: { locationId: string; entries: { weekday?: number | null; onDate?: string | null; opens?: string | null; closes?: string | null; closed?: boolean; label?: string | null }[] };
    output: { id: string; locationId: string; weekday: number | null; onDate: string | null; opens: string | null; closes: string | null; closed: boolean; label: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "locations.setPrimary": {
    input: { id: string };
    output: { id: string; name: string; slug: string; isPrimary: boolean; schemaType: string | null; street: string | null; unit: string | null; city: string | null; region: string | null; postalCode: string | null; country: string; latitude: string | null; longitude: string | null; phone: string | null; email: string | null; googleBusinessProfileUrl: string | null; sameAs: string[]; priceRange: string | null; timezone: string | null; status: "visible" | "hidden"; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "locations.setServiceArea": {
    input: { locationId: string; area: ({ kind: "radius"; centerLatitude: number; centerLongitude: number; radiusKm: number } | { kind: "regions"; regions: string[] }) | null };
    output: { id: string; locationId: string; kind: "radius" | "regions"; centerLatitude: string | null; centerLongitude: string | null; radiusKm: string | null; regions: string[]; createdAt: string; updatedAt: string; [key: string]: unknown } | null;
  };
  "locations.update": {
    input: { name?: string; slug?: string; schemaType?: string | null; street?: string | null; unit?: string | null; city?: string | null; region?: string | null; postalCode?: string | null; country?: string; latitude?: number | null; longitude?: number | null; phone?: string | null; email?: string | null; googleBusinessProfileUrl?: string | null; sameAs?: string[]; priceRange?: string | null; timezone?: string | null; status?: "visible" | "hidden"; id: string };
    output: { id: string; name: string; slug: string; isPrimary: boolean; schemaType: string | null; street: string | null; unit: string | null; city: string | null; region: string | null; postalCode: string | null; country: string; latitude: string | null; longitude: string | null; phone: string | null; email: string | null; googleBusinessProfileUrl: string | null; sameAs: string[]; priceRange: string | null; timezone: string | null; status: "visible" | "hidden"; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "loyalty.adjustPoints": {
    input: { accountId: string; delta: number; note: string };
    output: { balance: number; [key: string]: unknown };
  };
  "loyalty.earnRules": {
    input: { programId: string };
    output: { id: string; name: string; eventType: string; formula: "fixed" | "per_currency_unit" | "multiplier"; points: number; capPerPeriod: number | null; capPeriodDays: number; startsAt: string | null; endsAt: string | null; priority: number; active: "yes" | "no"; [key: string]: unknown }[];
  };
  "loyalty.earnableEvents": {
    input: Record<string, never>;
    output: { eventType: string; direction: string; [key: string]: unknown }[];
  };
  "loyalty.enrol": {
    input: { contactId: string; programId: string };
    output: { accountId: string; alreadyEnrolled: boolean; [key: string]: unknown };
  };
  "loyalty.liability": {
    input: { programId: string };
    output: { programId: string; outstandingPoints: number; valueMinor: number; currency: string; accounts: number; [key: string]: unknown };
  };
  "loyalty.myStatement": {
    input: { programId: string; limit?: number };
    output: { accountId: string; programId: string; pointsLabel: string; balance: number; lifetimePoints: number; entries: { id: string; delta: number; reason: "earn" | "redeem" | "expire" | "adjust" | "reverse"; ruleName: string | null; sourceType: string | null; sourceId: string | null; reversesId: string | null; note: string | null; at: string; [key: string]: unknown }[]; [key: string]: unknown } | null;
  };
  "loyalty.programs": {
    input: Record<string, never>;
    output: { id: string; name: string; pointsLabel: string; status: "draft" | "active" | "closed"; earnCurrency: string; redemptionValueCents: number; expiryPolicy: unknown; enrolment: "automatic" | "opt_in"; minAccountAgeDays: number; [key: string]: unknown }[];
  };
  "loyalty.redeem": {
    input: { accountId: string; rewardId: string };
    output: { redemptionId: string; pointsSpent: number; balance: number; reference: string | null; issuedBy: string; status: "issued" | "manual" | "used" | "expired" | "reversed"; [key: string]: unknown };
  };
  "loyalty.redemptions": {
    input: { programId: string; limit?: number };
    output: { id: string; accountId: string; rewardName: string; pointsSpent: number; issuedReference: string | null; issuedBy: string | null; status: "issued" | "manual" | "used" | "expired" | "reversed"; at: string; [key: string]: unknown }[];
  };
  "loyalty.reevaluateTier": {
    input: { accountId: string };
    output: { from: string | null; to: string | null; direction: "promoted" | "demoted" | "unchanged"; [key: string]: unknown };
  };
  "loyalty.rewards": {
    input: { programId: string };
    output: { id: string; programId: string; name: string; kind: "discount" | "free_product" | "free_shipping" | "gift_card" | "pass_credits" | "donation"; costPoints: number; value: unknown; stock: number | null; perContactLimit: number | null; status: "draft" | "active" | "retired"; [key: string]: unknown }[];
  };
  "loyalty.saveEarnRule": {
    input: { id?: string; programId: string; name: string; eventType: string; formula?: "fixed" | "per_currency_unit" | "multiplier"; points: number; capPerPeriod?: number | null; capPeriodDays?: number; startsAt?: string | null; endsAt?: string | null; priority?: number; active?: "yes" | "no" };
    output: { id: string; eventType: string; [key: string]: unknown };
  };
  "loyalty.saveProgram": {
    input: { id?: string; name: string; pointsLabel?: string; status?: "draft" | "active" | "closed"; earnCurrency?: string; redemptionValueCents?: number; expiryPolicy?: { kind: "never" } | { kind: "inactivity"; days: number; noticeDays: number } | { kind: "fixed_window"; days: number; noticeDays: number }; enrolment?: "automatic" | "opt_in"; termsPageId?: string | null; minAccountAgeDays?: number };
    output: { id: string; name: string; pointsLabel: string; status: "draft" | "active" | "closed"; earnCurrency: string; redemptionValueCents: number; expiryPolicy: unknown; enrolment: "automatic" | "opt_in"; minAccountAgeDays: number; [key: string]: unknown };
  };
  "loyalty.saveReward": {
    input: { id?: string; programId: string; name: string; kind: "discount" | "free_product" | "free_shipping" | "gift_card" | "pass_credits" | "donation"; costPoints: number; value?: { percentOffPpm?: number; amountMinor?: number; currency?: string; productId?: string }; stock?: number | null; perContactLimit?: number | null; eligibleTierIds?: string[]; status?: "draft" | "active" | "retired" };
    output: { id: string; programId: string; name: string; kind: "discount" | "free_product" | "free_shipping" | "gift_card" | "pass_credits" | "donation"; costPoints: number; value: unknown; stock: number | null; perContactLimit: number | null; status: "draft" | "active" | "retired"; [key: string]: unknown };
  };
  "loyalty.saveTier": {
    input: { id?: string; programId: string; name: string; thresholdBasis?: "points_earned" | "lifetime_spend"; threshold: number; windowDays?: number; benefits?: { pointsMultiplier?: number; freeShipping?: boolean; earlyAccess?: boolean; perks?: string[] }; position: number };
    output: { id: string; programId: string; name: string; thresholdBasis: "points_earned" | "lifetime_spend"; threshold: number; windowDays: number; benefits: unknown; position: number; [key: string]: unknown };
  };
  "loyalty.statement": {
    input: { contactId: string; programId: string; limit?: number };
    output: { accountId: string; programId: string; pointsLabel: string; balance: number; lifetimePoints: number; entries: { id: string; delta: number; reason: "earn" | "redeem" | "expire" | "adjust" | "reverse"; ruleName: string | null; sourceType: string | null; sourceId: string | null; reversesId: string | null; note: string | null; at: string; [key: string]: unknown }[]; [key: string]: unknown } | null;
  };
  "loyalty.tiers": {
    input: { programId: string };
    output: { id: string; programId: string; name: string; thresholdBasis: "points_earned" | "lifetime_spend"; threshold: number; windowDays: number; benefits: unknown; position: number; [key: string]: unknown }[];
  };
  "mail.beginOAuth": {
    input: { provider: "google" | "microsoft"; returnTo?: string };
    output: { authorizationUrl: string };
  };
  "mail.completeOAuth": {
    input: { provider: "google" | "microsoft"; state: string; code: string };
    output: { senderId: string; email: string; returnTo: string };
  };
  "mail.registerSender": {
    input: { purpose: "transactional" | "bulk"; provider: "smtp" | "resend" | "postmark" | "ses"; email: string; displayName?: string; providerIdentity?: string };
    output: { id: string; purpose: "transactional" | "bulk"; provider: "gmail" | "outlook" | "smtp" | "console" | "resend" | "postmark" | "ses"; connectedAccountId: string | null; email: string; displayName: string | null; providerIdentity: string | null; verificationStatus: "pending" | "verified" | "failed"; status: "active" | "paused" | "needs_attention"; isDefault: boolean; verificationDetail: unknown; lastVerifiedAt: string | null; lastError: string | null; createdBy: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "mail.releaseSuppression": {
    input: { email: string; confirmation: string };
    output: { email: string; reason: "hard_bounce" | "complaint" | "provider" | "manual"; provider: "resend" | "postmark" | "ses" | "manual"; sourceEventId: string | null; detail: string | null; active: boolean; releasedAt: string | null; releasedBy: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "mail.setDefaultSender": {
    input: { id: string };
    output: { id: string; purpose: "transactional" | "bulk"; provider: "gmail" | "outlook" | "smtp" | "console" | "resend" | "postmark" | "ses"; connectedAccountId: string | null; email: string; displayName: string | null; providerIdentity: string | null; verificationStatus: "pending" | "verified" | "failed"; status: "active" | "paused" | "needs_attention"; isDefault: boolean; verificationDetail: unknown; lastVerifiedAt: string | null; lastError: string | null; createdBy: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "mail.status": {
    input: { limit?: number };
    output: { configuration: { transactional: { provider: "smtp" | "console" | "gmail" | "outlook"; delivers: boolean; missing: string[]; fromAddress: string | null }; oauth: { provider: "google" | "microsoft"; configured: boolean; missing: string[] }[]; bulk: { provider: "resend" | "postmark" | "ses" | "none"; sendConfigured: boolean; feedbackConfigured: boolean; missing: string[]; webhookPath: string | null; fromAddress: string | null } }; senders: { id: string; purpose: "transactional" | "bulk"; provider: "gmail" | "outlook" | "smtp" | "console" | "resend" | "postmark" | "ses"; email: string; displayName: string | null; verificationStatus: "pending" | "verified" | "failed"; status: "active" | "paused" | "needs_attention"; isDefault: boolean; lastVerifiedAt: string | null; lastError: string | null; createdAt: string; accountStatus: ("active" | "needs_reconnect" | "revoked") | null; capabilityEnabled: boolean | null; [key: string]: unknown }[]; deliveries: { id: string; senderId: string | null; purpose: "transactional" | "bulk"; provider: "gmail" | "outlook" | "smtp" | "console" | "resend" | "postmark" | "ses" | "none"; recipient: string; subject: string; status: "queued" | "submitted" | "delivered" | "bounced" | "complained" | "failed" | "suppressed"; providerRef: string | null; idempotencyKey: string | null; requestedBy: string; attempts: number; lastError: string | null; submittedAt: string | null; deliveredAt: string | null; providerStatusAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[]; suppressions: { email: string; reason: "hard_bounce" | "complaint" | "provider" | "manual"; provider: "resend" | "postmark" | "ses" | "manual"; sourceEventId: string | null; detail: string | null; active: boolean; releasedAt: string | null; releasedBy: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[] };
  };
  "mail.testSend": {
    input: { id: string };
    output: { id: string; provider: "gmail" | "outlook" | "smtp" | "console" | "resend" | "postmark" | "ses" | "none"; providerRef: string | null; delivers: boolean; duplicate: boolean };
  };
  "mail.updateSender": {
    input: { id: string; status: "active" | "paused" };
    output: { id: string; purpose: "transactional" | "bulk"; provider: "gmail" | "outlook" | "smtp" | "console" | "resend" | "postmark" | "ses"; connectedAccountId: string | null; email: string; displayName: string | null; providerIdentity: string | null; verificationStatus: "pending" | "verified" | "failed"; status: "active" | "paused" | "needs_attention"; isDefault: boolean; verificationDetail: unknown; lastVerifiedAt: string | null; lastError: string | null; createdBy: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "mail.verifySender": {
    input: { id: string };
    output: { id: string; purpose: "transactional" | "bulk"; provider: "gmail" | "outlook" | "smtp" | "console" | "resend" | "postmark" | "ses"; connectedAccountId: string | null; email: string; displayName: string | null; providerIdentity: string | null; verificationStatus: "pending" | "verified" | "failed"; status: "active" | "paused" | "needs_attention"; isDefault: boolean; verificationDetail: unknown; lastVerifiedAt: string | null; lastError: string | null; createdBy: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "marketplace.connect": {
    input: { name: string; provider: "shopify" | "etsy" | "amazon" | "ebay"; channelId?: string };
    output: { id: string; name: string; provider: string; status: string; externalRef: string | null; lastError: string | null; lastSyncedAt: string | null; [key: string]: unknown };
  };
  "marketplace.list": {
    input: Record<string, never>;
    output: { id: string; name: string; provider: string; status: string; externalRef: string | null; lastError: string | null; lastSyncedAt: string | null; [key: string]: unknown }[];
  };
  "marketplace.sync": {
    input: { channelId: string };
    output: { imported: number; lastError: string | null; [key: string]: unknown };
  };
  "media.abortUpload": {
    input: { id: string };
    output: { ok: true };
  };
  "media.acceptAltTextSuggestion": {
    input: { id: string; suggestionId: string; altText: string };
    output: { id: string; kind: "image" | "video" | "doc" | "audio"; storageKey: string; filename: string; mime: string; legacyBytes: number; bytes: number; width: number | null; height: number | null; durationSeconds: number | null; variants: unknown; altText: string | null; blurhash: string | null; status: "processing" | "ready" | "quarantined" | "failed" | "trashed"; scanStatus: "pending" | "clean" | "not_configured" | "infected" | "error"; scanEngine: string | null; scanMessage: string | null; scannedAt: string | null; checksumSha256: string | null; metadata: unknown; provenance: unknown; source: "upload" | "import" | "generated" | "migration" | "capture"; uploadedBy: string | null; focalX: number; focalY: number; deletedAt: string | null; purgeAfter: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "media.altTextSuggestionState": {
    input: { id: string };
    output: { available: boolean; provider: string; model: string | null; unavailableReason: string | null; suggestion: { id: string; assetId: string; status: "ready" | "accepted" | "dismissed" | "superseded"; suggestion: string; provider: string; model: string; promptVersion: string; sourceChecksum: string; authoredAltTextAtRequest: string | null; requestedBy: string; reviewedBy: string | null; reviewedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown } | null };
  };
  "media.appendCaptureChunk": {
    input: { id?: string; token?: string; sequence: number; contentType?: string; bytes: unknown };
    output: { sessionId: string; sequence: number; bytes: number };
  };
  "media.assembleCapture": {
    input: { id?: string; token?: string; filename?: string; expectedChunks?: number };
    output: { session: { id: string; source: "camera" | "microphone" | "screen" | "share_sheet" | "camera_roll" | "upload_link" | "import" | "social"; status: "pending" | "live" | "preview" | "confirmed" | "discarded" | "expired"; targetType: string | null; targetId: string | null; uploadCount: number; displaySurface: string | null; permissionGrantedAt: string | null; trimStartMs: number; trimEndMs: number | null; caption: string | null; focalX: number; focalY: number; staged: boolean; stagedMime: string | null; stagedFilename: string | null; items: { id: string; filename: string; bytes: number; mime: string; assetId: string | null }[]; uploadId: string | null; assetId: string | null; expiresAt: string; completedAt: string | null; captureUrl: string | null; [key: string]: unknown }; asset: null };
  };
  "media.attachCaptureUpload": {
    input: { id?: string; token?: string; filename: string; contentType: string; bytes: unknown; width?: number; height?: number; durationSeconds?: number };
    output: { session: { id: string; source: "camera" | "microphone" | "screen" | "share_sheet" | "camera_roll" | "upload_link" | "import" | "social"; status: "pending" | "live" | "preview" | "confirmed" | "discarded" | "expired"; targetType: string | null; targetId: string | null; uploadCount: number; displaySurface: string | null; permissionGrantedAt: string | null; trimStartMs: number; trimEndMs: number | null; caption: string | null; focalX: number; focalY: number; staged: boolean; stagedMime: string | null; stagedFilename: string | null; items: { id: string; filename: string; bytes: number; mime: string; assetId: string | null }[]; uploadId: string | null; assetId: string | null; expiresAt: string; completedAt: string | null; captureUrl: string | null; [key: string]: unknown }; asset: null };
  };
  "media.authorizeAssetDownload": {
    input: { id: string };
    output: { storageKey: string; filename: string; mime: string; bytes: number; [key: string]: unknown } | null;
  };
  "media.authorizeObjectDelivery": {
    input: { key: string };
    output: { contentType: string; filename: string; kind: "image" | "video" | "doc" | "audio"; [key: string]: unknown } | null;
  };
  "media.beginUpload": {
    input: { filename: string; contentType: string; bytes: number; altText?: string; source?: "upload" | "import" | "generated" | "migration" | "capture"; provenance?: { sourceUrl?: string; capturedAt?: string; lastModifiedAt?: string; note?: string; captureToken?: string; captureSessionId?: string }; metadata?: { width?: number; height?: number; durationSeconds?: number; pageCount?: number; codec?: string; trimStartMs?: number; trimEndMs?: number } };
    output: { id: string; strategy: "direct_multipart" | "proxy"; partSize: number | null; partCount: number | null; expiresAt: string };
  };
  "media.bindCaptureAsset": {
    input: { id?: string; token?: string; assetId: string };
    output: { id: string; source: "camera" | "microphone" | "screen" | "share_sheet" | "camera_roll" | "upload_link" | "import" | "social"; status: "pending" | "live" | "preview" | "confirmed" | "discarded" | "expired"; targetType: string | null; targetId: string | null; uploadCount: number; displaySurface: string | null; permissionGrantedAt: string | null; trimStartMs: number; trimEndMs: number | null; caption: string | null; focalX: number; focalY: number; staged: boolean; stagedMime: string | null; stagedFilename: string | null; items: { id: string; filename: string; bytes: number; mime: string; assetId: string | null }[]; uploadId: string | null; assetId: string | null; expiresAt: string; completedAt: string | null; captureUrl: string | null; [key: string]: unknown };
  };
  "media.completeUpload": {
    input: { id: string; parts: { partNumber: number; etag: string }[]; altText?: string };
    output: { ok: true; asset: { id: string; kind: "image" | "video" | "doc" | "audio"; storageKey: string; filename: string; mime: string; legacyBytes: number; bytes: number; width: number | null; height: number | null; durationSeconds: number | null; variants: unknown; altText: string | null; blurhash: string | null; status: "processing" | "ready" | "quarantined" | "failed" | "trashed"; scanStatus: "pending" | "clean" | "not_configured" | "infected" | "error"; scanEngine: string | null; scanMessage: string | null; scannedAt: string | null; checksumSha256: string | null; metadata: unknown; provenance: unknown; source: "upload" | "import" | "generated" | "migration" | "capture"; uploadedBy: string | null; focalX: number; focalY: number; deletedAt: string | null; purgeAfter: string | null; createdAt: string; updatedAt: string; [key: string]: unknown } | null } | { ok: false; message: string };
  };
  "media.confirmCapture": {
    input: { id?: string; token?: string };
    output: { id: string; source: "camera" | "microphone" | "screen" | "share_sheet" | "camera_roll" | "upload_link" | "import" | "social"; status: "pending" | "live" | "preview" | "confirmed" | "discarded" | "expired"; targetType: string | null; targetId: string | null; uploadCount: number; displaySurface: string | null; permissionGrantedAt: string | null; trimStartMs: number; trimEndMs: number | null; caption: string | null; focalX: number; focalY: number; staged: boolean; stagedMime: string | null; stagedFilename: string | null; items: { id: string; filename: string; bytes: number; mime: string; assetId: string | null }[]; uploadId: string | null; assetId: string | null; expiresAt: string; completedAt: string | null; captureUrl: string | null; [key: string]: unknown };
  };
  "media.createCaptureSession": {
    input: { source: "camera" | "microphone" | "screen"; targetType?: string; targetId?: string };
    output: { id: string; source: "camera" | "microphone" | "screen" | "share_sheet" | "camera_roll" | "upload_link" | "import" | "social"; status: "pending" | "live" | "preview" | "confirmed" | "discarded" | "expired"; targetType: string | null; targetId: string | null; uploadCount: number; displaySurface: string | null; permissionGrantedAt: string | null; trimStartMs: number; trimEndMs: number | null; caption: string | null; focalX: number; focalY: number; staged: boolean; stagedMime: string | null; stagedFilename: string | null; items: { id: string; filename: string; bytes: number; mime: string; assetId: string | null }[]; uploadId: string | null; assetId: string | null; expiresAt: string; completedAt: string | null; captureUrl: string | null; [key: string]: unknown };
  };
  "media.createUploadLink": {
    input: { source?: "upload_link" | "camera_roll" | "share_sheet"; targetType?: string; targetId?: string };
    output: { id: string; source: "camera" | "microphone" | "screen" | "share_sheet" | "camera_roll" | "upload_link" | "import" | "social"; status: "pending" | "live" | "preview" | "confirmed" | "discarded" | "expired"; targetType: string | null; targetId: string | null; uploadCount: number; displaySurface: string | null; permissionGrantedAt: string | null; trimStartMs: number; trimEndMs: number | null; caption: string | null; focalX: number; focalY: number; staged: boolean; stagedMime: string | null; stagedFilename: string | null; items: { id: string; filename: string; bytes: number; mime: string; assetId: string | null }[]; uploadId: string | null; assetId: string | null; expiresAt: string; completedAt: string | null; captureUrl: string | null; token: string; qrSvg: string; [key: string]: unknown };
  };
  "media.discardCapture": {
    input: { id: string };
    output: { id: string; source: "camera" | "microphone" | "screen" | "share_sheet" | "camera_roll" | "upload_link" | "import" | "social"; status: "pending" | "live" | "preview" | "confirmed" | "discarded" | "expired"; targetType: string | null; targetId: string | null; uploadCount: number; displaySurface: string | null; permissionGrantedAt: string | null; trimStartMs: number; trimEndMs: number | null; caption: string | null; focalX: number; focalY: number; staged: boolean; stagedMime: string | null; stagedFilename: string | null; items: { id: string; filename: string; bytes: number; mime: string; assetId: string | null }[]; uploadId: string | null; assetId: string | null; expiresAt: string; completedAt: string | null; captureUrl: string | null; [key: string]: unknown };
  };
  "media.dismissAltTextSuggestion": {
    input: { id: string; suggestionId: string };
    output: { ok: true };
  };
  "media.expireCaptureSessions": {
    input: Record<string, never>;
    output: { expired: string[] };
  };
  "media.generateAltTextSuggestion": {
    input: { id: string };
    output: { id: string; assetId: string; status: "ready" | "accepted" | "dismissed" | "superseded"; suggestion: string; provider: string; model: string; promptVersion: string; sourceChecksum: string; authoredAltTextAtRequest: string | null; requestedBy: string; reviewedBy: string | null; reviewedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "media.get": {
    input: { id: string };
    output: { id: string; kind: "image" | "video" | "doc" | "audio"; storageKey: string; filename: string; mime: string; legacyBytes: number; bytes: number; width: number | null; height: number | null; durationSeconds: number | null; variants: unknown; altText: string | null; blurhash: string | null; status: "processing" | "ready" | "quarantined" | "failed" | "trashed"; scanStatus: "pending" | "clean" | "not_configured" | "infected" | "error"; scanEngine: string | null; scanMessage: string | null; scannedAt: string | null; checksumSha256: string | null; metadata: unknown; provenance: unknown; source: "upload" | "import" | "generated" | "migration" | "capture"; uploadedBy: string | null; focalX: number; focalY: number; deletedAt: string | null; purgeAfter: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "media.getCaptureSession": {
    input: { id?: string; token?: string };
    output: { id: string; source: "camera" | "microphone" | "screen" | "share_sheet" | "camera_roll" | "upload_link" | "import" | "social"; status: "pending" | "live" | "preview" | "confirmed" | "discarded" | "expired"; targetType: string | null; targetId: string | null; uploadCount: number; displaySurface: string | null; permissionGrantedAt: string | null; trimStartMs: number; trimEndMs: number | null; caption: string | null; focalX: number; focalY: number; staged: boolean; stagedMime: string | null; stagedFilename: string | null; items: { id: string; filename: string; bytes: number; mime: string; assetId: string | null }[]; uploadId: string | null; assetId: string | null; expiresAt: string; completedAt: string | null; captureUrl: string | null; [key: string]: unknown } | null;
  };
  "media.grantCapturePermission": {
    input: { id: string; displaySurface?: "monitor" | "window" | "browser" };
    output: { id: string; source: "camera" | "microphone" | "screen" | "share_sheet" | "camera_roll" | "upload_link" | "import" | "social"; status: "pending" | "live" | "preview" | "confirmed" | "discarded" | "expired"; targetType: string | null; targetId: string | null; uploadCount: number; displaySurface: string | null; permissionGrantedAt: string | null; trimStartMs: number; trimEndMs: number | null; caption: string | null; focalX: number; focalY: number; staged: boolean; stagedMime: string | null; stagedFilename: string | null; items: { id: string; filename: string; bytes: number; mime: string; assetId: string | null }[]; uploadId: string | null; assetId: string | null; expiresAt: string; completedAt: string | null; captureUrl: string | null; [key: string]: unknown };
  };
  "media.list": {
    input: { kind?: "image" | "video" | "doc" | "audio"; status?: "processing" | "ready" | "quarantined" | "failed" | "trashed"; includeUnavailable?: boolean; includeTrashed?: boolean; limit?: number; offset?: number };
    output: { rows: { id: string; kind: "image" | "video" | "doc" | "audio"; storageKey: string; filename: string; mime: string; legacyBytes: number; bytes: number; width: number | null; height: number | null; durationSeconds: number | null; variants: unknown; altText: string | null; blurhash: string | null; status: "processing" | "ready" | "quarantined" | "failed" | "trashed"; scanStatus: "pending" | "clean" | "not_configured" | "infected" | "error"; scanEngine: string | null; scanMessage: string | null; scannedAt: string | null; checksumSha256: string | null; metadata: unknown; provenance: unknown; source: "upload" | "import" | "generated" | "migration" | "capture"; uploadedBy: string | null; focalX: number; focalY: number; deletedAt: string | null; purgeAfter: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[]; total: number };
  };
  "media.listAltTextSuggestionStates": {
    input: { ids: string[] };
    output: { available: boolean; provider: string; model: string | null; unavailableReason: string | null; suggestions: { id: string; assetId: string; status: "ready" | "accepted" | "dismissed" | "superseded"; suggestion: string; provider: string; model: string; promptVersion: string; sourceChecksum: string; authoredAltTextAtRequest: string | null; requestedBy: string; reviewedBy: string | null; reviewedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[] };
  };
  "media.listCaptureSessions": {
    input: { status?: "pending" | "live" | "preview" | "confirmed" | "discarded" | "expired" };
    output: { id: string; source: "camera" | "microphone" | "screen" | "share_sheet" | "camera_roll" | "upload_link" | "import" | "social"; status: "pending" | "live" | "preview" | "confirmed" | "discarded" | "expired"; targetType: string | null; targetId: string | null; uploadCount: number; displaySurface: string | null; permissionGrantedAt: string | null; trimStartMs: number; trimEndMs: number | null; caption: string | null; focalX: number; focalY: number; staged: boolean; stagedMime: string | null; stagedFilename: string | null; items: { id: string; filename: string; bytes: number; mime: string; assetId: string | null }[]; uploadId: string | null; assetId: string | null; expiresAt: string; completedAt: string | null; captureUrl: string | null; [key: string]: unknown }[];
  };
  "media.purge": {
    input: { id: string; confirmation: string };
    output: { ok: true; assetId: string; objects: number };
  };
  "media.rescan": {
    input: { id: string };
    output: { id: string; kind: "image" | "video" | "doc" | "audio"; storageKey: string; filename: string; mime: string; legacyBytes: number; bytes: number; width: number | null; height: number | null; durationSeconds: number | null; variants: unknown; altText: string | null; blurhash: string | null; status: "processing" | "ready" | "quarantined" | "failed" | "trashed"; scanStatus: "pending" | "clean" | "not_configured" | "infected" | "error"; scanEngine: string | null; scanMessage: string | null; scannedAt: string | null; checksumSha256: string | null; metadata: unknown; provenance: unknown; source: "upload" | "import" | "generated" | "migration" | "capture"; uploadedBy: string | null; focalX: number; focalY: number; deletedAt: string | null; purgeAfter: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "media.resolveAsset": {
    input: { id: string };
    output: { id: string; kind: "video" | "doc" | "audio"; src: string; mime: string; filename: string; bytes: number; width: number | null; height: number | null; durationSeconds: number | null } | null;
  };
  "media.resolveImage": {
    input: { id: string };
    output: { src: string; sources: { format: string; srcset: string; type: string }[]; width: number | null; height: number | null; altText: string | null } | null;
  };
  "media.restore": {
    input: { id: string };
    output: { id: string; kind: "image" | "video" | "doc" | "audio"; storageKey: string; filename: string; mime: string; legacyBytes: number; bytes: number; width: number | null; height: number | null; durationSeconds: number | null; variants: unknown; altText: string | null; blurhash: string | null; status: "processing" | "ready" | "quarantined" | "failed" | "trashed"; scanStatus: "pending" | "clean" | "not_configured" | "infected" | "error"; scanEngine: string | null; scanMessage: string | null; scannedAt: string | null; checksumSha256: string | null; metadata: unknown; provenance: unknown; source: "upload" | "import" | "generated" | "migration" | "capture"; uploadedBy: string | null; focalX: number; focalY: number; deletedAt: string | null; purgeAfter: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "media.reviewCapture": {
    input: { id: string; trimStartMs?: number; trimEndMs?: number | null; caption?: string | null; focalX?: number; focalY?: number };
    output: { id: string; source: "camera" | "microphone" | "screen" | "share_sheet" | "camera_roll" | "upload_link" | "import" | "social"; status: "pending" | "live" | "preview" | "confirmed" | "discarded" | "expired"; targetType: string | null; targetId: string | null; uploadCount: number; displaySurface: string | null; permissionGrantedAt: string | null; trimStartMs: number; trimEndMs: number | null; caption: string | null; focalX: number; focalY: number; staged: boolean; stagedMime: string | null; stagedFilename: string | null; items: { id: string; filename: string; bytes: number; mime: string; assetId: string | null }[]; uploadId: string | null; assetId: string | null; expiresAt: string; completedAt: string | null; captureUrl: string | null; [key: string]: unknown };
  };
  "media.setAltText": {
    input: { id: string; altText: string };
    output: { id: string; kind: "image" | "video" | "doc" | "audio"; storageKey: string; filename: string; mime: string; legacyBytes: number; bytes: number; width: number | null; height: number | null; durationSeconds: number | null; variants: unknown; altText: string | null; blurhash: string | null; status: "processing" | "ready" | "quarantined" | "failed" | "trashed"; scanStatus: "pending" | "clean" | "not_configured" | "infected" | "error"; scanEngine: string | null; scanMessage: string | null; scannedAt: string | null; checksumSha256: string | null; metadata: unknown; provenance: unknown; source: "upload" | "import" | "generated" | "migration" | "capture"; uploadedBy: string | null; focalX: number; focalY: number; deletedAt: string | null; purgeAfter: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "media.setFocalPoint": {
    input: { id: string; x: number; y: number };
    output: { id: string; kind: "image" | "video" | "doc" | "audio"; storageKey: string; filename: string; mime: string; legacyBytes: number; bytes: number; width: number | null; height: number | null; durationSeconds: number | null; variants: unknown; altText: string | null; blurhash: string | null; status: "processing" | "ready" | "quarantined" | "failed" | "trashed"; scanStatus: "pending" | "clean" | "not_configured" | "infected" | "error"; scanEngine: string | null; scanMessage: string | null; scannedAt: string | null; checksumSha256: string | null; metadata: unknown; provenance: unknown; source: "upload" | "import" | "generated" | "migration" | "capture"; uploadedBy: string | null; focalX: number; focalY: number; deletedAt: string | null; purgeAfter: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "media.signUploadParts": {
    input: { id: string; partNumbers: number[] };
    output: { parts: { partNumber: number; url: string; method: "PUT" }[]; expiresAt: string };
  };
  "media.stageCompletedUpload": {
    input: { uploadId: string; token?: string; sessionId?: string; filename: string; contentType: string; key: string; bytes: number; checksumSha256?: string };
    output: { id: string; source: "camera" | "microphone" | "screen" | "share_sheet" | "camera_roll" | "upload_link" | "import" | "social"; status: "pending" | "live" | "preview" | "confirmed" | "discarded" | "expired"; targetType: string | null; targetId: string | null; uploadCount: number; displaySurface: string | null; permissionGrantedAt: string | null; trimStartMs: number; trimEndMs: number | null; caption: string | null; focalX: number; focalY: number; staged: boolean; stagedMime: string | null; stagedFilename: string | null; items: { id: string; filename: string; bytes: number; mime: string; assetId: string | null }[]; uploadId: string | null; assetId: string | null; expiresAt: string; completedAt: string | null; captureUrl: string | null; [key: string]: unknown };
  };
  "media.startCapture": {
    input: { id: string };
    output: { id: string; source: "camera" | "microphone" | "screen" | "share_sheet" | "camera_roll" | "upload_link" | "import" | "social"; status: "pending" | "live" | "preview" | "confirmed" | "discarded" | "expired"; targetType: string | null; targetId: string | null; uploadCount: number; displaySurface: string | null; permissionGrantedAt: string | null; trimStartMs: number; trimEndMs: number | null; caption: string | null; focalX: number; focalY: number; staged: boolean; stagedMime: string | null; stagedFilename: string | null; items: { id: string; filename: string; bytes: number; mime: string; assetId: string | null }[]; uploadId: string | null; assetId: string | null; expiresAt: string; completedAt: string | null; captureUrl: string | null; [key: string]: unknown };
  };
  "media.stopCapture": {
    input: { id: string };
    output: { id: string; source: "camera" | "microphone" | "screen" | "share_sheet" | "camera_roll" | "upload_link" | "import" | "social"; status: "pending" | "live" | "preview" | "confirmed" | "discarded" | "expired"; targetType: string | null; targetId: string | null; uploadCount: number; displaySurface: string | null; permissionGrantedAt: string | null; trimStartMs: number; trimEndMs: number | null; caption: string | null; focalX: number; focalY: number; staged: boolean; stagedMime: string | null; stagedFilename: string | null; items: { id: string; filename: string; bytes: number; mime: string; assetId: string | null }[]; uploadId: string | null; assetId: string | null; expiresAt: string; completedAt: string | null; captureUrl: string | null; [key: string]: unknown };
  };
  "media.trash": {
    input: { id: string };
    output: { id: string; kind: "image" | "video" | "doc" | "audio"; storageKey: string; filename: string; mime: string; legacyBytes: number; bytes: number; width: number | null; height: number | null; durationSeconds: number | null; variants: unknown; altText: string | null; blurhash: string | null; status: "processing" | "ready" | "quarantined" | "failed" | "trashed"; scanStatus: "pending" | "clean" | "not_configured" | "infected" | "error"; scanEngine: string | null; scanMessage: string | null; scannedAt: string | null; checksumSha256: string | null; metadata: unknown; provenance: unknown; source: "upload" | "import" | "generated" | "migration" | "capture"; uploadedBy: string | null; focalX: number; focalY: number; deletedAt: string | null; purgeAfter: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "media.updateDetails": {
    input: { id: string; metadata?: { width?: number; height?: number; durationSeconds?: number; pageCount?: number; codec?: string; trimStartMs?: number; trimEndMs?: number }; provenance?: { sourceUrl?: string; capturedAt?: string; lastModifiedAt?: string; note?: string; captureToken?: string; captureSessionId?: string } };
    output: { id: string; kind: "image" | "video" | "doc" | "audio"; storageKey: string; filename: string; mime: string; legacyBytes: number; bytes: number; width: number | null; height: number | null; durationSeconds: number | null; variants: unknown; altText: string | null; blurhash: string | null; status: "processing" | "ready" | "quarantined" | "failed" | "trashed"; scanStatus: "pending" | "clean" | "not_configured" | "infected" | "error"; scanEngine: string | null; scanMessage: string | null; scannedAt: string | null; checksumSha256: string | null; metadata: unknown; provenance: unknown; source: "upload" | "import" | "generated" | "migration" | "capture"; uploadedBy: string | null; focalX: number; focalY: number; deletedAt: string | null; purgeAfter: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "media.upload": {
    input: { filename: string; contentType: string; bytes: unknown; altText?: string; uploadId?: string; source?: "upload" | "import" | "generated" | "migration" | "capture"; provenance?: { sourceUrl?: string; capturedAt?: string; lastModifiedAt?: string; note?: string; captureToken?: string; captureSessionId?: string }; metadata?: { width?: number; height?: number; durationSeconds?: number; pageCount?: number; codec?: string; trimStartMs?: number; trimEndMs?: number } };
    output: { id: string; kind: "image" | "video" | "doc" | "audio"; storageKey: string; filename: string; mime: string; legacyBytes: number; bytes: number; width: number | null; height: number | null; durationSeconds: number | null; variants: unknown; altText: string | null; blurhash: string | null; status: "processing" | "ready" | "quarantined" | "failed" | "trashed"; scanStatus: "pending" | "clean" | "not_configured" | "infected" | "error"; scanEngine: string | null; scanMessage: string | null; scannedAt: string | null; checksumSha256: string | null; metadata: unknown; provenance: unknown; source: "upload" | "import" | "generated" | "migration" | "capture"; uploadedBy: string | null; focalX: number; focalY: number; deletedAt: string | null; purgeAfter: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "media.uploadStatus": {
    input: { id: string };
    output: { id: string; strategy: "direct_multipart" | "proxy"; state: "created" | "uploading" | "uploaded" | "processing" | "complete" | "failed" | "aborted" | "expired"; filename: string; contentType: string; expectedBytes: number; partSize: number | null; partCount: number | null; parts: { partNumber: number; etag: string; bytes?: number }[]; assetId: string | null; failureReason: string | null; expiresAt: string };
  };
  "media.usage": {
    input: { id: string };
    output: { pages: number; sections: number };
  };
  "messaging.checkNumbers": {
    input: Record<string, never>;
    output: { checked: number; problems: number; [key: string]: unknown };
  };
  "messaging.complianceEvents": {
    input: { contactId?: string };
    output: { id: string; contactId: string; providerRef: string; intent: "stop" | "start" | "help"; keyword: string; locale: string; occurredAt: string; createdAt: string; [key: string]: unknown }[];
  };
  "messaging.createKeywordRule": {
    input: { keyword: string; match?: "exact" | "prefix"; action: "opt_out" | "opt_in" | "help" | "auto_reply" | "tag" | "route" | "booking_confirm"; actionValue?: string | null; replyBody?: string | null; locale?: "*" | string; active?: boolean };
    output: { id: string; keyword: string; normalizedKeyword: string; match: "exact" | "prefix"; action: "opt_out" | "opt_in" | "help" | "auto_reply" | "tag" | "route" | "booking_confirm"; actionValue: string | null; replyBody: string | null; locale: string; active: boolean; createdBy: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "messaging.deleteKeywordRule": {
    input: { id: string };
    output: { ok: true; [key: string]: unknown };
  };
  "messaging.endSiteChat": {
    input: { token: string };
    output: { ok: true };
  };
  "messaging.escalateAssistantChat": {
    input: { conversationId: string; reason: string; message?: string };
    output: { conversationId: string; escalatedAt: string; [key: string]: unknown };
  };
  "messaging.evaluateSmsPolicy": {
    input: { contactId: string; to: string; purpose: "transactional" | "marketing" | "support"; exception?: { kind: "security_code" | "booking_update" | "order_update" | "customer_requested_reply"; referenceId: string }; at?: string };
    output: { allowed: boolean; reason: "allowed" | "quiet_hours" | "daily_cap" | "weekly_cap"; timezone: string; localTime: string; blockedBy: { id: string; code: string; name: string } | null; exceptionApplied: ("security_code" | "booking_update" | "order_update" | "customer_requested_reply") | null };
  };
  "messaging.getSiteChat": {
    input: { token: string };
    output: { state: "open" | "closed"; escalated: boolean; messages: { id: string; direction: "inbound" | "outbound"; channel: "chat" | "assistant"; body: string; occurredAt: string; [key: string]: unknown }[]; expiresAt: string; [key: string]: unknown };
  };
  "messaging.importNumbers": {
    input: { provider?: string };
    output: { found: number; added: number; [key: string]: unknown };
  };
  "messaging.keywordEvents": {
    input: { contactId?: string };
    output: { id: string; providerRef: string; ruleId: string | null; contactId: string; conversationId: string; action: "opt_out" | "opt_in" | "help" | "auto_reply" | "tag" | "route" | "booking_confirm"; outcome: "applied" | "refused" | "noop"; detail: string | null; bookingId: string | null; createdAt: string; [key: string]: unknown }[];
  };
  "messaging.keywordRules": {
    input: { includeInactive?: boolean };
    output: { id: string; keyword: string; normalizedKeyword: string; match: "exact" | "prefix"; action: "opt_out" | "opt_in" | "help" | "auto_reply" | "tag" | "route" | "booking_confirm"; actionValue: string | null; replyBody: string | null; locale: string; active: boolean; createdBy: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "messaging.numbers": {
    input: Record<string, never>;
    output: { id: string; provider: string; providerRef: string; e164: string; label: string | null; country: string | null; kind: "long_code" | "toll_free" | "short_code" | "alphanumeric"; capabilities: unknown; purpose: "transactional" | "marketing" | "support"; isDefault: boolean; active: boolean; healthy: boolean; healthUnknown: boolean; healthProblem: string | null; providerStatus: string | null; healthCheckedAt: string | null; registrations: unknown; [key: string]: unknown }[];
  };
  "messaging.postSiteChat": {
    input: { token: string; message: string };
    output: { state: "open" | "closed"; escalated: boolean; messages: { id: string; direction: "inbound" | "outbound"; channel: "chat" | "assistant"; body: string; occurredAt: string; [key: string]: unknown }[]; expiresAt: string; [key: string]: unknown };
  };
  "messaging.registrations": {
    input: Record<string, never>;
    output: { id: string; e164: string; country: string | null; kind: "long_code" | "toll_free" | "short_code" | "alphanumeric"; state: "not_required" | "not_started" | "submitted" | "in_review" | "approved" | "rejected" | "expired"; canSend: boolean; problem: string | null; required: { kind: "10dlc" | "toll_free_verification" | "sender_id"; guidance: string; state: "not_required" | "not_started" | "submitted" | "in_review" | "approved" | "rejected" | "expired"; brand: string | null; campaign: string | null; providerRef: string | null; reason: string | null; [key: string]: unknown }[]; [key: string]: unknown }[];
  };
  "messaging.sendAssistantChatMessage": {
    input: { conversationId: string; message: string };
    output: { id: string; [key: string]: unknown };
  };
  "messaging.sendSms": {
    input: { contactId?: string; to: string; body: string; purpose?: "transactional" | "marketing" | "support"; policyException?: { kind: "security_code" | "booking_update" | "order_update" | "customer_requested_reply"; referenceId: string }; mediaAssetIds?: string[]; templateId?: string; conversationId?: string; idempotencyKey: string };
    output: { sent: boolean; providerRef: string | null; reason: string | null; messageId: string | null; [key: string]: unknown };
  };
  "messaging.setRegistration": {
    input: { id: string; kind: "10dlc" | "toll_free_verification" | "sender_id"; state: "not_required" | "not_started" | "submitted" | "in_review" | "approved" | "rejected" | "expired"; brand?: string | null; campaign?: string | null; providerRef?: string | null; reason?: string | null };
    output: { id: string; provider: string; providerRef: string; e164: string; label: string | null; country: string | null; kind: "long_code" | "toll_free" | "short_code" | "alphanumeric"; capabilities: unknown; purpose: "transactional" | "marketing" | "support"; isDefault: boolean; active: boolean; healthy: boolean; healthUnknown: boolean; healthProblem: string | null; providerStatus: string | null; healthCheckedAt: string | null; registrations: unknown; [key: string]: unknown };
  };
  "messaging.setWindow": {
    input: { id?: string; code?: string; name: string; scope: "global" | "segment" | "contact"; contactId?: string | null; segmentId?: string | null; quietFrom?: string | null; quietTo?: string | null; timezoneSource?: "contact" | "business"; maxPerDay?: number | null; maxPerWeek?: number | null; appliesTo?: "marketing" | "transactional" | "all"; active?: boolean };
    output: { id: string; code: string; name: string; scope: "global" | "segment" | "contact"; contactId: string | null; segmentId: string | null; quietFrom: string | null; quietTo: string | null; timezoneSource: "contact" | "business"; maxPerDay: number | null; maxPerWeek: number | null; appliesTo: "marketing" | "transactional" | "all"; active: boolean; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "messaging.startSiteChat": {
    input: { name: string; email: string; message: string; locale?: string };
    output: { ok: true; token: string; conversationId: string; contactId: string; [key: string]: unknown };
  };
  "messaging.updateKeywordRule": {
    input: { keyword?: string; match?: "exact" | "prefix"; action?: "opt_out" | "opt_in" | "help" | "auto_reply" | "tag" | "route" | "booking_confirm"; actionValue?: string | null; replyBody?: string | null; locale?: "*" | string; active?: boolean; id: string };
    output: { id: string; keyword: string; normalizedKeyword: string; match: "exact" | "prefix"; action: "opt_out" | "opt_in" | "help" | "auto_reply" | "tag" | "route" | "booking_confirm"; actionValue: string | null; replyBody: string | null; locale: string; active: boolean; createdBy: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "messaging.updateNumber": {
    input: { id: string; label?: string | null; purpose?: "transactional" | "marketing" | "support"; isDefault?: boolean; active?: boolean };
    output: { id: string; provider: string; providerRef: string; e164: string; label: string | null; country: string | null; kind: "long_code" | "toll_free" | "short_code" | "alphanumeric"; capabilities: unknown; purpose: "transactional" | "marketing" | "support"; isDefault: boolean; active: boolean; healthy: boolean; healthUnknown: boolean; healthProblem: string | null; providerStatus: string | null; healthCheckedAt: string | null; registrations: unknown; [key: string]: unknown };
  };
  "messaging.windows": {
    input: Record<string, never>;
    output: { id: string; code: string; name: string; scope: "global" | "segment" | "contact"; contactId: string | null; segmentId: string | null; quietFrom: string | null; quietTo: string | null; timezoneSource: "contact" | "business"; maxPerDay: number | null; maxPerWeek: number | null; appliesTo: "marketing" | "transactional" | "all"; active: boolean; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "newsletters.confirm": {
    input: { token: string };
    output: { id: string; newsletterId: string; contactId: string; status: "pending" | "confirmed" | "unsubscribed"; confirmToken: string; unsubscribeToken: string; confirmedAt: string | null; unsubscribedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "newsletters.create": {
    input: { name: string; slug: string; description?: string };
    output: { id: string; name: string; slug: string; description: string | null; status: "active" | "paused"; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "newsletters.createIssue": {
    input: { newsletterId: string; slug: string; title: string; excerpt?: string; body?: string };
    output: { id: string; newsletterId: string; slug: string; title: string; excerpt: string | null; body: string; status: "draft" | "published"; seo: unknown; workingTitle: string | null; workingExcerpt: string | null; workingBody: string | null; workingSeo: unknown | null; version: number; publishedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "newsletters.get": {
    input: { id: string };
    output: { newsletter: { id: string; name: string; slug: string; description: string | null; status: "active" | "paused"; createdAt: string; updatedAt: string; [key: string]: unknown }; issues: { id: string; newsletterId: string; slug: string; title: string; excerpt: string | null; body: string; status: "draft" | "published"; seo: unknown; workingTitle: string | null; workingExcerpt: string | null; workingBody: string | null; workingSeo: unknown | null; version: number; publishedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[]; subscriptions: { id: string; newsletterId: string; contactId: string; status: "pending" | "confirmed" | "unsubscribed"; confirmToken: string; unsubscribeToken: string; confirmedAt: string | null; unsubscribedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[] };
  };
  "newsletters.list": {
    input: Record<string, never>;
    output: { id: string; name: string; slug: string; description: string | null; status: "active" | "paused"; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "newsletters.listPublic": {
    input: Record<string, never>;
    output: { id: string; name: string; slug: string; description: string | null; status: "active" | "paused"; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "newsletters.listPublicIssues": {
    input: Record<string, never>;
    output: { id: string; newsletterId: string; slug: string; title: string; excerpt: string | null; body: string; status: "draft" | "published"; seo: unknown; workingTitle: string | null; workingExcerpt: string | null; workingBody: string | null; workingSeo: unknown | null; version: number; publishedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "newsletters.publishIssue": {
    input: { id: string; expectedVersion: number };
    output: { id: string; newsletterId: string; slug: string; title: string; excerpt: string | null; body: string; status: "draft" | "published"; seo: unknown; workingTitle: string | null; workingExcerpt: string | null; workingBody: string | null; workingSeo: unknown | null; version: number; publishedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "newsletters.resolvePublicIssue": {
    input: { slug: string };
    output: { id: string; newsletterId: string; slug: string; title: string; excerpt: string | null; body: string; status: "draft" | "published"; seo: unknown; workingTitle: string | null; workingExcerpt: string | null; workingBody: string | null; workingSeo: unknown | null; version: number; publishedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown } | null;
  };
  "newsletters.subscribe": {
    input: { newsletterId: string; email: string; name?: string; consent?: { termsVersion: string; sourceUrl: string | null; evidence: { popup: string; statement: string } } };
    output: { status: "confirmed" | "pending"; subscriptionId: string };
  };
  "newsletters.unsubscribe": {
    input: { token: string };
    output: { id: string; newsletterId: string; contactId: string; status: "pending" | "confirmed" | "unsubscribed"; confirmToken: string; unsubscribeToken: string; confirmedAt: string | null; unsubscribedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "newsletters.update": {
    input: { id: string; name?: string; description?: string | null; status?: "active" | "paused" };
    output: { id: string; name: string; slug: string; description: string | null; status: "active" | "paused"; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "newsletters.updateIssue": {
    input: { id: string; expectedVersion: number; title?: string; excerpt?: string | null; body?: string; seo?: { title?: string; description?: string } };
    output: { id: string; newsletterId: string; slug: string; title: string; excerpt: string | null; body: string; status: "draft" | "published"; seo: unknown; workingTitle: string | null; workingExcerpt: string | null; workingBody: string | null; workingSeo: unknown | null; version: number; publishedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "notes.edit": {
    input: { id: string; body?: string; visibility?: "team" | "private" | "shared"; mentions?: string[] };
    output: { id: string; subjectType: "contact" | "deal" | "quote" | "invoice" | "booking" | "project" | "contract" | "order"; subjectId: string; contactId: string | null; authorUserId: string | null; body: string; visibility: "team" | "private" | "shared"; pinned: boolean; pinnedAt: string | null; mentions: string[]; editCount: number; editedAt: string | null; createdAt: string; [key: string]: unknown };
  };
  "notes.history": {
    input: { id: string };
    output: { id: string; body: string; editedBy: string | null; editedByEmail: string | null; editedAt: string; [key: string]: unknown }[];
  };
  "notes.list": {
    input: { subjectType?: "contact" | "deal" | "quote" | "invoice" | "booking" | "project" | "contract" | "order"; subjectId?: string; contactId?: string; mentioning?: string; pinnedOnly?: boolean; limit?: number };
    output: { id: string; subjectType: "contact" | "deal" | "quote" | "invoice" | "booking" | "project" | "contract" | "order"; subjectId: string; contactId: string | null; authorUserId: string | null; body: string; visibility: "team" | "private" | "shared"; pinned: boolean; pinnedAt: string | null; mentions: string[]; editCount: number; editedAt: string | null; createdAt: string; authorEmail: string | null; contactName: string | null; href: string; [key: string]: unknown }[];
  };
  "notes.pin": {
    input: { id: string; pinned: boolean };
    output: { id: string; subjectType: "contact" | "deal" | "quote" | "invoice" | "booking" | "project" | "contract" | "order"; subjectId: string; contactId: string | null; authorUserId: string | null; body: string; visibility: "team" | "private" | "shared"; pinned: boolean; pinnedAt: string | null; mentions: string[]; editCount: number; editedAt: string | null; createdAt: string; [key: string]: unknown };
  };
  "notes.remove": {
    input: { id: string };
    output: { id: string; [key: string]: unknown };
  };
  "notes.write": {
    input: { subjectType: "contact" | "deal" | "quote" | "invoice" | "booking" | "project" | "contract" | "order"; subjectId: string; body: string; visibility?: "team" | "private" | "shared"; pinned?: boolean; mentions?: string[] };
    output: { id: string; subjectType: "contact" | "deal" | "quote" | "invoice" | "booking" | "project" | "contract" | "order"; subjectId: string; contactId: string | null; authorUserId: string | null; body: string; visibility: "team" | "private" | "shared"; pinned: boolean; pinnedAt: string | null; mentions: string[]; editCount: number; editedAt: string | null; createdAt: string; [key: string]: unknown };
  };
  "notifications.archive": {
    input: { id: string };
    output: { archived: true };
  };
  "notifications.list": {
    input: { state?: "all" | "unread" | "critical"; limit?: number; before?: string };
    output: { id: string; topic: string; priority: "information" | "warning" | "critical"; locale: string; title: string; body: string; href: string | null; occurrenceCount: number; firstOccurredAt: string; lastOccurredAt: string; readAt: string | null; escalatedAt: string | null; [key: string]: unknown }[];
  };
  "notifications.markAllRead": {
    input: Record<string, never>;
    output: { changed: number };
  };
  "notifications.markRead": {
    input: { id: string; read?: boolean };
    output: { id: string; readAt: string | null };
  };
  "notifications.preferences": {
    input: Record<string, never>;
    output: { topics: string[]; preferences: { topic: string; channel: "in_app" | "email" | "sms" | "push"; mode: "immediate" | "digest" | "off"; [key: string]: unknown }[]; settings: { digestCadence: "daily" | "weekly"; digestMinute: number; digestWeekday: number; timezone: string | null; escalationMinutes: number; [key: string]: unknown }; email: { provider: "smtp" | "console" | "gmail" | "outlook"; ready: boolean }; adapters: { channel: "sms" | "push"; provider: string; available: boolean; message: string }[] };
  };
  "notifications.unreadCount": {
    input: Record<string, never>;
    output: number;
  };
  "notifications.updatePreference": {
    input: { topic: string; channel: "in_app" | "email" | "sms" | "push"; mode: "immediate" | "digest" | "off" };
    output: { id: string; userId: string | null; contactId: string | null; topic: string; channel: "in_app" | "email" | "sms" | "push"; mode: "immediate" | "digest" | "off"; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "notifications.updatePreferences": {
    input: { preferences: { topic: string; channel: "in_app" | "email" | "sms" | "push"; mode: "immediate" | "digest" | "off" }[] };
    output: { saved: number };
  };
  "notifications.updateSettings": {
    input: { digestCadence: "daily" | "weekly"; digestMinute: number; digestWeekday: number; timezone: string; escalationMinutes: number };
    output: { id: string; userId: string | null; contactId: string | null; digestCadence: "daily" | "weekly"; digestMinute: number; digestWeekday: number; timezone: string | null; escalationMinutes: number; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "paywalls.evaluate": {
    input: { paywallId?: string; kind?: "page" | "post" | "gallery" | "collection" | "tag" | "product"; selector: string; anonId?: string | null };
    output: { gated: boolean; allowed: boolean; reveal: "all" | "preview" | "none"; previewStrategy: "blocks" | "paragraphs" | "percent"; previewValue: number; seoPolicy: ("flexible_sampling" | "fully_gated") | null; paywallId: string | null; upsellPageId: string | null; [key: string]: unknown };
  };
  "paywalls.list": {
    input: { status?: "active" | "archived"; limit?: number };
    output: { id: string; name: string; appliesTo: { kind: "page" | "post" | "gallery" | "collection" | "tag" | "product"; selector: string }; mode: "hard" | "soft" | "metered" | "registration"; meterCount: number; meterWindowDays: number; previewStrategy: "blocks" | "paragraphs" | "percent"; previewValue: number; requiredEntitlementIds: string[]; upsellPageId: string | null; seoPolicy: "flexible_sampling" | "fully_gated"; status: "active" | "archived"; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "paywalls.save": {
    input: { id?: string; name: string; appliesTo: { kind: "page" | "post" | "gallery" | "collection" | "tag" | "product"; selector: string }; mode?: "hard" | "soft" | "metered" | "registration"; meterCount?: number; meterWindowDays?: number; previewStrategy?: "blocks" | "paragraphs" | "percent"; previewValue?: number; requiredEntitlementIds?: string[]; upsellPageId?: string | null; seoPolicy?: "flexible_sampling" | "fully_gated"; status?: "active" | "archived" };
    output: { id: string; name: string; appliesTo: { kind: "page" | "post" | "gallery" | "collection" | "tag" | "product"; selector: string }; mode: "hard" | "soft" | "metered" | "registration"; meterCount: number; meterWindowDays: number; previewStrategy: "blocks" | "paragraphs" | "percent"; previewValue: number; requiredEntitlementIds: string[]; upsellPageId: string | null; seoPolicy: "flexible_sampling" | "fully_gated"; status: "active" | "archived"; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "platform.applyUpdate": {
    input: { toVersion?: string; digest?: string; drainMs?: number };
    output: { id: string; status: string; snapshotId: string | null; noteId: string | null };
  };
  "platform.cancelJob": {
    input: { name: string; id: string; confirm: "CANCEL" };
    output: { cancelled: true };
  };
  "platform.checkUpdates": {
    input: Record<string, never>;
    output: { checked: boolean; reason: ("off" | "slot") | null; keyId: string | null; releases: { version: string; channel: "stable" | "security" | "edge"; digest: string; severity: "none" | "low" | "medium" | "high" | "critical" }[] };
  };
  "platform.compatibility": {
    input: Record<string, never>;
    output: { version: string; compatible: boolean; plugins: { name: string; version: string; freeholder: string; fits: boolean; [key: string]: unknown }[]; [key: string]: unknown };
  };
  "platform.cspViolations": {
    input: { days?: number; limit?: number };
    output: { fingerprint: string; documentPath: string; effectiveDirective: string; blockedSource: string; occurrences: number; lastAt: string; [key: string]: unknown }[];
  };
  "platform.describeRelease": {
    input: { fromVersion?: string };
    output: { version: string; channel: "stable" | "security" | "edge"; minFromVersion: string; schemaRisk: "compatible" | "breaking"; cvss: number | null; severity: "none" | "low" | "medium" | "high" | "critical"; manualSteps: { id: string; summary: string }[]; pluginApi: string; channels: { id: "stable" | "security" | "edge"; holds: string }[]; apply: { fromVersion: string; ok: boolean; reason: string } | null };
  };
  "platform.describeUpdateTargets": {
    input: Record<string, never>;
    output: { thisTarget: string | null; swaps: boolean; targets: { target: string; strategy: "image-swap" | "deploy-hook" | "source-pull"; means: string; rollbackArtifact: string; cutoverCost: string }[] };
  };
  "platform.doctor": {
    input: Record<string, never>;
    output: { verdict: "ok" | "warn" | "fail"; checks: { id: string; title: string; verdict: "ok" | "warn" | "fail"; detail: string; remedy?: string; [key: string]: unknown }[]; ranAt: string };
  };
  "platform.evaluateUpdatePolicy": {
    input: { channel: "stable" | "security" | "edge"; now?: string; timezone?: string };
    output: { offered: boolean; autoApply: boolean; requiresApproval: boolean };
  };
  "platform.export": {
    input: { outputDirectory?: string };
    output: { ok: true; format: string; directory: string; files: number; checksum?: string };
  };
  "platform.forkStatus": {
    input: { root?: string };
    output: { fork: boolean; reason: string | null; ahead: number; behind: number; status: "current" | "behind" | "behind-security"; sentence: string; worstCvss: number | null; ownedByYou: string[]; replaceableCore: string[]; missing: { version: string; severity: "none" | "low" | "medium" | "high" | "critical"; cvss: number | null; notesUrl: string; publishedAt: string }[]; missingSecurity: { version: string; severity: "none" | "low" | "medium" | "high" | "critical"; cvss: number | null; notesUrl: string; publishedAt: string }[] };
  };
  "platform.getJob": {
    input: { name: string; id: string };
    output: { id: string; name: string; data: unknown; output: unknown; state: "created" | "retry" | "active" | "completed" | "cancelled" | "failed"; stuck: boolean; [key: string]: unknown };
  };
  "platform.getOutboxEvent": {
    input: { id: string };
    output: { id: string; eventName: string; status: "pending" | "dispatched" | "dead_letter"; payload: unknown; deliveries: unknown[]; [key: string]: unknown };
  };
  "platform.getUpdatePolicy": {
    input: { now?: string };
    output: { channel: "security" | "stable" | "edge" | "off"; applyLevel: "security" | "patch" | "minor" | "none"; window: { days: ("sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat")[]; start: string }; drain: boolean; notifyChannels: string[]; keepSnapshots: number; lastCheckedAt: string | null; pausedUntil: string | null; timezone: string; inWindow: boolean; paused: boolean };
  };
  "platform.inspectSeams": {
    input: { root?: string };
    output: { version: string; seams: { id: "database" | "plugins" | "configuration" | "uploads"; holds: string; status: "ok" | "warn" | "fail"; detail: string }[]; core: { digest: string; expected: string | null; matches: boolean | null; modified: string[]; supported: boolean } };
  };
  "platform.jobSummary": {
    input: Record<string, never>;
    output: { queued: number; active: number; completed: number; cancelled: number; failed: number; deadLetters: number; stuck: number; total: number };
  };
  "platform.listJobQueues": {
    input: Record<string, never>;
    output: string[];
  };
  "platform.listJobs": {
    input: { name?: string; state?: "created" | "retry" | "active" | "completed" | "cancelled" | "failed"; limit?: number; offset?: number };
    output: { items: { id: string; name: string; data: unknown; output: unknown; state: "created" | "retry" | "active" | "completed" | "cancelled" | "failed"; stuck: boolean; [key: string]: unknown }[]; total: number };
  };
  "platform.listOutboxEvents": {
    input: { status?: "pending" | "dispatched" | "dead_letter"; eventName?: string; limit?: number; offset?: number };
    output: { items: { id: string; eventName: string; status: "pending" | "dispatched" | "dead_letter"; attempts: number; replayCount: number; nextAttemptAt: string | null; deadLetteredAt: string | null; lastError: string | null; createdAt: string; [key: string]: unknown }[]; total: number };
  };
  "platform.listUpdateRuns": {
    input: { limit?: number };
    output: { runs: { id: string; fromVersion: string; toVersion: string; status: string; trigger: string; startedAt: string }[]; notes: { id: string; title: string; kind: string; occurredAt: string }[] };
  };
  "platform.openForkUpdate": {
    input: { root?: string; toVersion?: string };
    output: { opened: boolean; url: string | null; branch: string | null; number: number | null; refusal: string | null; conflicts: { path: string; owner: "core" | "seam" | "ignored" }[]; ownerConflicts: string[] };
  };
  "platform.outboxSummary": {
    input: Record<string, never>;
    output: { pending: number; dispatched: number; deadLetters: number };
  };
  "platform.preflightUpdate": {
    input: { feed?: unknown; targetVersion?: string };
    output: { ok: boolean; estimatedDowntimeMs: number; steps: { id: string; verdict: "ok" | "warn" | "fail"; detail: string }[] };
  };
  "platform.redriveDeadLetters": {
    input: { sourceName?: string; limit?: number; confirm: "REDRIVE" };
    output: { moved: number };
  };
  "platform.replayOutboxEvent": {
    input: { id: string; confirm: "REPLAY" };
    output: { replayed: true; replayCount: number; jobId: string };
  };
  "platform.retryJob": {
    input: { name: string; id: string; confirm: "RETRY" };
    output: { retried: true };
  };
  "platform.saveUpdatePolicy": {
    input: { channel: "security" | "stable" | "edge" | "off"; applyLevel: "security" | "patch" | "minor" | "none"; window: { days: ("sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat")[]; start: string }; drain: boolean; notifyChannels: ("email" | "sms")[]; keepSnapshots: number; pausedUntil?: string | null };
    output: { channel: "security" | "stable" | "edge" | "off"; applyLevel: "security" | "patch" | "minor" | "none"; keepSnapshots: number; pruned: number };
  };
  "platform.source": {
    input: { includeLicenceText?: boolean; changeLimit?: number };
    output: { version: string; license: string; licenseText: string | null; notices: { name: string; license: string; note: string | null }[]; plugins: { name: string; version: string; status: string; license: string | null; permissions: string[] }[]; builderChanges: { id: string; lane: "structure" | "code"; summary: string; status: string; reference: string | null; actor: string; at: string }[] };
  };
  "platform.updateCheckPolicy": {
    input: Record<string, never>;
    output: { enabled: boolean; feedUrl: string; reports: false; slot: number };
  };
  "platform.verifyReleaseFeed": {
    input: { feed: unknown };
    output: { keyId: string; signedAt: string; releases: { version: string; channel: "stable" | "security" | "edge"; digest: string; image: string; notesUrl: string; schemaRisk: "compatible" | "breaking"; cvss: number | null; severity: "none" | "low" | "medium" | "high" | "critical" }[] };
  };
  "platform.version": {
    input: Record<string, never>;
    output: { version: string; contract: { openapi: string; mcpProtocol: string; webhookSchema: number }; exportFormat: string; targets: string[]; [key: string]: unknown };
  };
  "plugins.addRegistry": {
    input: { name: string; url: string; tier?: "verified" | "community" | "private" | "local" };
    output: { id: string; name: string; url: string; tier: "verified" | "community" | "private" | "local"; [key: string]: unknown };
  };
  "plugins.cacheRegistry": {
    input: { url: string; index: unknown; signature: string; signingSecret: string };
    output: { id: string; name: string; url: string; plugins: number; [key: string]: unknown };
  };
  "plugins.disable": {
    input: { name: string; reason?: string };
    output: { id: string; name: string; version: string; status: "installed" | "enabled" | "disabled"; source: string; tier: "verified" | "community" | "private" | "local"; integrity: string; signature: string | null; license: string; freeholder: string; permissions: unknown; config: unknown; disabledReason: string | null; previousVersion: string | null; installedBy: string; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "plugins.enable": {
    input: { name: string };
    output: { id: string; name: string; version: string; status: "installed" | "enabled" | "disabled"; source: string; tier: "verified" | "community" | "private" | "local"; integrity: string; signature: string | null; license: string; freeholder: string; permissions: unknown; config: unknown; disabledReason: string | null; previousVersion: string | null; installedBy: string; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "plugins.get": {
    input: { name: string };
    output: { id: string; name: string; version: string; status: "installed" | "enabled" | "disabled"; source: string; tier: "verified" | "community" | "private" | "local"; integrity: string; signature: string | null; license: string; freeholder: string; permissions: unknown; config: unknown; disabledReason: string | null; previousVersion: string | null; installedBy: string; createdAt: string; updatedAt: string; [key: string]: unknown } | null;
  };
  "plugins.install": {
    input: { path: string; expectedIntegrity?: string; signature?: string; signingSecret?: string };
    output: { id: string; name: string; version: string; status: "installed" | "enabled" | "disabled"; source: string; tier: "verified" | "community" | "private" | "local"; integrity: string; signature: string | null; license: string; freeholder: string; permissions: unknown; config: unknown; disabledReason: string | null; previousVersion: string | null; installedBy: string; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "plugins.list": {
    input: Record<string, never>;
    output: { id: string; name: string; version: string; status: "installed" | "enabled" | "disabled"; source: string; tier: "verified" | "community" | "private" | "local"; integrity: string; signature: string | null; license: string; freeholder: string; permissions: unknown; config: unknown; disabledReason: string | null; previousVersion: string | null; installedBy: string; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "plugins.listCatalog": {
    input: Record<string, never>;
    output: { name: string; version: string; tier: "verified" | "community" | "private" | "local"; license: string; permissions: unknown; freeholder: string; integrity: string; changelog: string; [key: string]: unknown }[];
  };
  "plugins.listRegistries": {
    input: Record<string, never>;
    output: { id: string; name: string; url: string; tier: "verified" | "community" | "private" | "local"; signature: string | null; cachedIndex: unknown; fetchedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "plugins.rollback": {
    input: { name: string };
    output: { id: string; name: string; version: string; status: "installed" | "enabled" | "disabled"; source: string; tier: "verified" | "community" | "private" | "local"; integrity: string; signature: string | null; license: string; freeholder: string; permissions: unknown; config: unknown; disabledReason: string | null; previousVersion: string | null; installedBy: string; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "plugins.uninstall": {
    input: { name: string; retention: "keep" | "purge" };
    output: { ok: true; name: string; retention: "keep" | "purge" };
  };
  "plugins.update": {
    input: { path: string; expectedIntegrity?: string };
    output: { id: string; name: string; version: string; status: "installed" | "enabled" | "disabled"; source: string; tier: "verified" | "community" | "private" | "local"; integrity: string; signature: string | null; license: string; freeholder: string; permissions: unknown; config: unknown; disabledReason: string | null; previousVersion: string | null; installedBy: string; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "popups.capture": {
    input: { popupId: string; email: string; consent: boolean; path?: string | null; visitorKey?: string | null; tally?: string | null };
    output: { ok: true; message: string | null; pending: boolean; tally: string; [key: string]: unknown };
  };
  "popups.decide": {
    input: { path?: string; locale?: string; visitorKey?: string | null; tally?: string | null };
    output: { id: string; title: string; surface: "modal" | "banner" | "corner"; trigger: "immediate" | "delay" | "scroll" | "exitIntent"; triggerValue: number; blocks: unknown; captureMode: "none" | "email"; consentStatement: string | null; successMessage: string | null; [key: string]: unknown } | null;
  };
  "popups.get": {
    input: { id: string };
    output: { id: string; slug: string; name: string; title: string; surface: "modal" | "banner" | "corner"; trigger: "immediate" | "delay" | "scroll" | "exitIntent"; triggerValue: number; blocks: unknown; audience: "everyone" | "inSegment" | "notInSegment"; segmentId: string | null; pathPatterns: unknown; locales: unknown; frequencyCap: number | null; frequencyPeriodHours: number; dismissSuppressHours: number; stopAfterCapture: boolean; captureMode: "none" | "email"; newsletterId: string | null; consentStatement: string | null; consentVersion: string | null; successMessage: string | null; startsAt: string | null; endsAt: string | null; priority: number; status: "draft" | "active" | "paused"; [key: string]: unknown };
  };
  "popups.list": {
    input: { status?: "draft" | "active" | "paused" };
    output: { id: string; slug: string; name: string; title: string; surface: "modal" | "banner" | "corner"; trigger: "immediate" | "delay" | "scroll" | "exitIntent"; triggerValue: number; blocks: unknown; audience: "everyone" | "inSegment" | "notInSegment"; segmentId: string | null; pathPatterns: unknown; locales: unknown; frequencyCap: number | null; frequencyPeriodHours: number; dismissSuppressHours: number; stopAfterCapture: boolean; captureMode: "none" | "email"; newsletterId: string | null; consentStatement: string | null; consentVersion: string | null; successMessage: string | null; startsAt: string | null; endsAt: string | null; priority: number; status: "draft" | "active" | "paused"; [key: string]: unknown }[];
  };
  "popups.performance": {
    input: { sinceDays?: number; popupId?: string };
    output: { popupId: string; shown: number; dismissed: number; captured: number; [key: string]: unknown }[];
  };
  "popups.record": {
    input: { popupId: string; kind: "shown" | "dismissed"; path?: string | null; visitorKey?: string | null; tally?: string | null };
    output: { ok: true; tally: string; [key: string]: unknown };
  };
  "popups.remove": {
    input: { id: string; confirm: true };
    output: { ok: true; [key: string]: unknown };
  };
  "popups.save": {
    input: { id?: string; slug: string; name: string; title: string; surface?: "modal" | "banner" | "corner"; trigger?: "immediate" | "delay" | "scroll" | "exitIntent"; triggerValue?: number; audience?: "everyone" | "inSegment" | "notInSegment"; segmentId?: string | null; pathPatterns?: string[]; locales?: string[]; frequencyCap?: number | null; frequencyPeriodHours?: number; dismissSuppressHours?: number; stopAfterCapture?: boolean; captureMode?: "none" | "email"; newsletterId?: string | null; consentStatement?: string | null; consentVersion?: string | null; successMessage?: string | null; startsAt?: string | null; endsAt?: string | null; priority?: number };
    output: { id: string; slug: string; name: string; title: string; surface: "modal" | "banner" | "corner"; trigger: "immediate" | "delay" | "scroll" | "exitIntent"; triggerValue: number; blocks: unknown; audience: "everyone" | "inSegment" | "notInSegment"; segmentId: string | null; pathPatterns: unknown; locales: unknown; frequencyCap: number | null; frequencyPeriodHours: number; dismissSuppressHours: number; stopAfterCapture: boolean; captureMode: "none" | "email"; newsletterId: string | null; consentStatement: string | null; consentVersion: string | null; successMessage: string | null; startsAt: string | null; endsAt: string | null; priority: number; status: "draft" | "active" | "paused"; [key: string]: unknown };
  };
  "popups.saveBlocks": {
    input: { id: string; blocks: unknown };
    output: { id: string; slug: string; name: string; title: string; surface: "modal" | "banner" | "corner"; trigger: "immediate" | "delay" | "scroll" | "exitIntent"; triggerValue: number; blocks: unknown; audience: "everyone" | "inSegment" | "notInSegment"; segmentId: string | null; pathPatterns: unknown; locales: unknown; frequencyCap: number | null; frequencyPeriodHours: number; dismissSuppressHours: number; stopAfterCapture: boolean; captureMode: "none" | "email"; newsletterId: string | null; consentStatement: string | null; consentVersion: string | null; successMessage: string | null; startsAt: string | null; endsAt: string | null; priority: number; status: "draft" | "active" | "paused"; [key: string]: unknown };
  };
  "popups.setStatus": {
    input: { id: string; status: "draft" | "active" | "paused" };
    output: { id: string; slug: string; name: string; title: string; surface: "modal" | "banner" | "corner"; trigger: "immediate" | "delay" | "scroll" | "exitIntent"; triggerValue: number; blocks: unknown; audience: "everyone" | "inSegment" | "notInSegment"; segmentId: string | null; pathPatterns: unknown; locales: unknown; frequencyCap: number | null; frequencyPeriodHours: number; dismissSuppressHours: number; stopAfterCapture: boolean; captureMode: "none" | "email"; newsletterId: string | null; consentStatement: string | null; consentVersion: string | null; successMessage: string | null; startsAt: string | null; endsAt: string | null; priority: number; status: "draft" | "active" | "paused"; [key: string]: unknown };
  };
  "portal.myProfile": {
    input: Record<string, never>;
    output: { contactId: string; name: string; email: string | null; phone: string | null; preferredLocale: string | null; hasPassword: boolean; createdAt: string; [key: string]: unknown };
  };
  "portal.myRecords": {
    input: { section?: string; limit?: number };
    output: { key: string; count: number; records: { id: string; title: string; status: string | null; at: string | null; href: string | null; amountMinor?: number | null; currency?: string | null; [key: string]: unknown }[]; failed: boolean; [key: string]: unknown }[];
  };
  "portal.updateMyProfile": {
    input: { name?: string; phone?: string | null };
    output: { contactId: string; name: string; email: string | null; phone: string | null; preferredLocale: string | null; hasPassword: boolean; createdAt: string; [key: string]: unknown };
  };
  "printOnDemand.list": {
    input: Record<string, never>;
    output: { id: string; sku: string; provider: string; status: string; externalRef: string | null; lastError: string | null; [key: string]: unknown }[];
  };
  "printOnDemand.queue": {
    input: { sku: string; provider: string; payload?: { [key: string]: unknown } };
    output: { id: string; sku: string; provider: string; status: string; externalRef: string | null; lastError: string | null; [key: string]: unknown };
  };
  "printOnDemand.submit": {
    input: { jobId: string };
    output: { id: string; sku: string; provider: string; status: string; externalRef: string | null; lastError: string | null; [key: string]: unknown };
  };
  "privacy.cancelMyDataRequest": {
    input: { id: string };
    output: { id: string; contactId: string; kind: "access" | "export" | "correction" | "erasure"; status: "submitted" | "verified" | "in_progress" | "completed" | "partially_completed" | "denied" | "cancelled"; jurisdiction: string | null; details: unknown; requestedBy: string; verificationMethod: string | null; verifiedAt: string | null; responseDueAt: string; resolution: string | null; fulfilledAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "privacy.createMyDataRequest": {
    input: { jurisdiction?: string | null; request: { kind: "access"; note?: string } | { kind: "export"; note?: string } | { kind: "erasure"; note?: string } | { kind: "correction"; note?: string; changes: { name?: string; email?: string | null; phone?: string | null; preferredLocale?: string | null; timezone?: string | null; country?: string | null } } };
    output: { id: string; contactId: string; kind: "access" | "export" | "correction" | "erasure"; status: "submitted" | "verified" | "in_progress" | "completed" | "partially_completed" | "denied" | "cancelled"; jurisdiction: string | null; details: unknown; requestedBy: string; verificationMethod: string | null; verifiedAt: string | null; responseDueAt: string; resolution: string | null; fulfilledAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "privacy.downloadMyDataRequestArtifact": {
    input: { id: string };
    output: { id: string; filename: string; mime: string; sha256: string; expiresAt: string; content: string };
  };
  "privacy.getMyProfile": {
    input: Record<string, never>;
    output: { effective: { purpose: "marketing" | "analytics" | "data_processing"; channel: ("email" | "sms" | "push" | "web") | null; state: "granted" | "denied" | "withdrawn" | "expired"; record: { id: string; contactId: string; purpose: "marketing" | "analytics" | "data_processing"; channel: ("email" | "sms" | "push" | "web") | null; state: "granted" | "denied" | "withdrawn"; method: "form" | "preference_center" | "double_opt_in" | "verbal" | "written" | "contract" | "import" | "system"; termsVersion: string | null; sourceUrl: string | null; ip: string | null; evidence: unknown; actor: string; occurredAt: string; expiresAt: string | null; createdAt: string; [key: string]: unknown } | null; [key: string]: unknown }[]; history: { id: string; contactId: string; purpose: "marketing" | "analytics" | "data_processing"; channel: ("email" | "sms" | "push" | "web") | null; state: "granted" | "denied" | "withdrawn"; method: "form" | "preference_center" | "double_opt_in" | "verbal" | "written" | "contract" | "import" | "system"; termsVersion: string | null; sourceUrl: string | null; ip: string | null; evidence: unknown; actor: string; occurredAt: string; expiresAt: string | null; createdAt: string; [key: string]: unknown }[]; contact: { id: string; name: string; email: string | null; phone: string | null; preferredLocale: string | null; timezone: string | null; country: string | null; [key: string]: unknown } };
  };
  "privacy.listMyDataRequests": {
    input: Record<string, never>;
    output: { request: { id: string; contactId: string; kind: "access" | "export" | "correction" | "erasure"; status: "submitted" | "verified" | "in_progress" | "completed" | "partially_completed" | "denied" | "cancelled"; jurisdiction: string | null; details: unknown; requestedBy: string; verificationMethod: string | null; verifiedAt: string | null; responseDueAt: string; resolution: string | null; fulfilledAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown }; artifact: { id: string | null; filename: string | null; sha256: string | null; expiresAt: string | null; [key: string]: unknown } | null; [key: string]: unknown }[];
  };
  "privacy.setMyMarketingPreference": {
    input: { channel: "email" | "sms" | "push"; state: "granted" | "withdrawn"; termsVersion: string };
    output: { contactId: string; preference: { id: string; contactId: string; purpose: "marketing" | "analytics" | "data_processing"; channel: ("email" | "sms" | "push" | "web") | null; state: "granted" | "denied" | "withdrawn"; method: "form" | "preference_center" | "double_opt_in" | "verbal" | "written" | "contract" | "import" | "system"; termsVersion: string | null; sourceUrl: string | null; ip: string | null; evidence: unknown; actor: string; occurredAt: string; expiresAt: string | null; createdAt: string; [key: string]: unknown } };
  };
  "projects.addTask": {
    input: { projectId: string; title: string; assigneeUserId?: string | null; dueOn?: string | null };
    output: { id: string; projectId: string; title: string; status: "open" | "doing" | "blocked" | "done" | "cancelled"; assigneeUserId: string | null; dueOn: string | null; position: number; doneAt: string | null; [key: string]: unknown };
  };
  "projects.addTestimonial": {
    input: { projectId: string; contactId: string; displayName: string; role?: string | null; body: string; rating?: number | null; assetId?: string | null; consentMethod: "contract" | "email" | "written" | "verbal" | "other"; consentNote?: string | null; displayLocations?: ("project" | "service" | "portfolio")[] };
    output: { id: string; projectId: string; contactId: string; displayName: string; role: string | null; body: string; rating: number | null; assetId: string | null; consentGivenAt: string; consentMethod: "contract" | "email" | "written" | "verbal" | "other"; consentNote: string | null; status: "draft" | "published" | "withdrawn"; displayLocations: string[]; [key: string]: unknown };
  };
  "projects.addToCollection": {
    input: { collectionId: string; projectId: string; position?: number };
    output: { id: string; collectionId: string; projectId: string; position: number; [key: string]: unknown };
  };
  "projects.attachFile": {
    input: { projectId: string; assetId: string; role?: "hero" | "gallery" | "before" | "after" | "process" | "detail" | "document"; pairKey?: string | null; caption?: string | null };
    output: { id: string; projectId: string; assetId: string; role: "hero" | "gallery" | "before" | "after" | "process" | "detail" | "document"; pairKey: string | null; caption: string | null; position: number; [key: string]: unknown };
  };
  "projects.create": {
    input: { title: string; slug?: string; contactId?: string | null; clientDisplayName?: string | null; summary?: string | null; ownerUserId?: string | null; locationId?: string | null; serviceProductIds?: string[]; startedOn?: string | null; notes?: string | null };
    output: { id: string; contactId: string | null; clientDisplayName: string | null; title: string; slug: string; summary: string | null; status: "enquiry" | "quoted" | "active" | "on_hold" | "complete" | "cancelled"; ownerUserId: string | null; locationId: string | null; serviceProductIds: string[]; startedOn: string | null; occurredOn: string | null; completedAt: string | null; notes: string | null; blocks: unknown; coverAssetId: string | null; featured: boolean; seo: unknown; publicationStatus: "draft" | "published"; publishedAt: string | null; publicPageId: string | null; clientConsentGivenAt: string | null; clientConsentMethod: ("contract" | "email" | "written" | "verbal" | "other") | null; clientConsentNote: string | null; version: number; [key: string]: unknown };
  };
  "projects.createCollection": {
    input: { name: string; slug?: string; kind: "portfolio" | "service" | "industry" | "season"; description?: string | null; coverAssetId?: string | null; position?: number };
    output: { id: string; name: string; slug: string; kind: "portfolio" | "service" | "industry" | "season"; description: string | null; coverAssetId: string | null; position: number; publicationStatus: "draft" | "published"; publishedAt: string | null; publicPageId: string | null; [key: string]: unknown };
  };
  "projects.detachFile": {
    input: { id: string };
    output: { id: string; projectId: string; [key: string]: unknown };
  };
  "projects.forSubject": {
    input: { kind: "quote" | "contract" | "booking" | "invoice" | "rental" | "form_submission"; targetId: string };
    output: { id: string; title: string; status: "enquiry" | "quoted" | "active" | "on_hold" | "complete" | "cancelled"; [key: string]: unknown }[];
  };
  "projects.get": {
    input: { id: string };
    output: { id: string; contactId: string | null; clientDisplayName: string | null; title: string; slug: string; summary: string | null; status: "enquiry" | "quoted" | "active" | "on_hold" | "complete" | "cancelled"; ownerUserId: string | null; locationId: string | null; serviceProductIds: string[]; startedOn: string | null; occurredOn: string | null; completedAt: string | null; notes: string | null; blocks: unknown; coverAssetId: string | null; featured: boolean; seo: unknown; publicationStatus: "draft" | "published"; publishedAt: string | null; publicPageId: string | null; clientConsentGivenAt: string | null; clientConsentMethod: ("contract" | "email" | "written" | "verbal" | "other") | null; clientConsentNote: string | null; version: number; contactName: string | null; links: { id: string; projectId: string; kind: "quote" | "contract" | "booking" | "invoice" | "rental" | "form_submission"; targetId: string; label: string | null; [key: string]: unknown }[]; tasks: { id: string; projectId: string; title: string; status: "open" | "doing" | "blocked" | "done" | "cancelled"; assigneeUserId: string | null; dueOn: string | null; position: number; doneAt: string | null; [key: string]: unknown }[]; outcomes: { id: string; projectId: string; label: string; value: string; unit: string | null; method: string | null; position: number; [key: string]: unknown }[]; files: { id: string; projectId: string; assetId: string; role: "hero" | "gallery" | "before" | "after" | "process" | "detail" | "document"; pairKey: string | null; caption: string | null; position: number; [key: string]: unknown }[]; testimonials: { id: string; projectId: string; contactId: string; displayName: string; role: string | null; body: string; rating: number | null; assetId: string | null; consentGivenAt: string; consentMethod: "contract" | "email" | "written" | "verbal" | "other"; consentNote: string | null; status: "draft" | "published" | "withdrawn"; displayLocations: string[]; [key: string]: unknown }[]; [key: string]: unknown } | null;
  };
  "projects.getCollection": {
    input: { id: string };
    output: { id: string; name: string; slug: string; kind: "portfolio" | "service" | "industry" | "season"; description: string | null; coverAssetId: string | null; position: number; publicationStatus: "draft" | "published"; publishedAt: string | null; publicPageId: string | null; projects: { id: string; collectionId: string; projectId: string; position: number; title: string; publicationStatus: "draft" | "published"; [key: string]: unknown }[]; [key: string]: unknown } | null;
  };
  "projects.link": {
    input: { projectId: string; kind: "quote" | "contract" | "booking" | "invoice" | "rental" | "form_submission"; targetId: string; label?: string | null };
    output: { id: string; projectId: string; kind: "quote" | "contract" | "booking" | "invoice" | "rental" | "form_submission"; targetId: string; label: string | null; [key: string]: unknown };
  };
  "projects.list": {
    input: { status?: "enquiry" | "quoted" | "active" | "on_hold" | "complete" | "cancelled"; contactId?: string; limit?: number };
    output: { id: string; contactId: string | null; clientDisplayName: string | null; title: string; slug: string; summary: string | null; status: "enquiry" | "quoted" | "active" | "on_hold" | "complete" | "cancelled"; ownerUserId: string | null; locationId: string | null; serviceProductIds: string[]; startedOn: string | null; occurredOn: string | null; completedAt: string | null; notes: string | null; blocks: unknown; coverAssetId: string | null; featured: boolean; seo: unknown; publicationStatus: "draft" | "published"; publishedAt: string | null; publicPageId: string | null; clientConsentGivenAt: string | null; clientConsentMethod: ("contract" | "email" | "written" | "verbal" | "other") | null; clientConsentNote: string | null; version: number; contactName: string | null; openTasks: number; [key: string]: unknown }[];
  };
  "projects.listCollections": {
    input: Record<string, never>;
    output: { id: string; name: string; slug: string; kind: "portfolio" | "service" | "industry" | "season"; description: string | null; coverAssetId: string | null; position: number; publicationStatus: "draft" | "published"; publishedAt: string | null; publicPageId: string | null; projectCount: number; [key: string]: unknown }[];
  };
  "projects.portfolioBrowse": {
    input: { service?: string; collection?: string; q?: string; limit?: number };
    output: { projects: { id: string; title: string; slug: string; href: string; summary: string | null; coverAssetId: string | null; occurredOn: string | null; featured: boolean; serviceProductIds: string[]; [key: string]: unknown }[]; collections: { id: string; name: string; slug: string; href: string; kind: "portfolio" | "service" | "industry" | "season"; description: string | null; coverAssetId: string | null; [key: string]: unknown }[]; services: { id: string; name: string; slug: string; [key: string]: unknown }[]; active: { service: string | null; collection: string | null; q: string | null } };
  };
  "projects.publicForService": {
    input: { productId: string; limit?: number };
    output: { id: string; title: string; slug: string; summary: string | null; href: string; featured: boolean; occurredOn: string | null; [key: string]: unknown }[];
  };
  "projects.publish": {
    input: { id: string };
    output: { id: string; href: string; pageId: string; publishedAt: string; [key: string]: unknown };
  };
  "projects.publishCollection": {
    input: { id: string };
    output: { id: string; href: string; pageId: string; [key: string]: unknown };
  };
  "projects.recordConsent": {
    input: { id: string; method: "contract" | "email" | "written" | "verbal" | "other"; note?: string | null };
    output: { id: string; givenAt: string; method: "contract" | "email" | "written" | "verbal" | "other"; [key: string]: unknown };
  };
  "projects.removeFromCollection": {
    input: { id: string };
    output: { id: string; collectionId: string; [key: string]: unknown };
  };
  "projects.removeOutcome": {
    input: { id: string };
    output: { id: string; projectId: string; [key: string]: unknown };
  };
  "projects.removeTask": {
    input: { id: string };
    output: { id: string; [key: string]: unknown };
  };
  "projects.resolvePublicProject": {
    input: { slug: string };
    output: { project: { id: string; title: string; slug: string; href: string; summary: string | null; coverAssetId: string | null; occurredOn: string | null; featured: boolean; serviceProductIds: string[]; [key: string]: unknown }; services: { id: string; name: string; slug: string; [key: string]: unknown }[]; images: { src: string; altText: string; role: string; [key: string]: unknown }[] } | null;
  };
  "projects.revokeConsent": {
    input: { id: string };
    output: { id: string; [key: string]: unknown };
  };
  "projects.saveCaseStudy": {
    input: { id: string; expectedVersion: number; blocks: unknown; coverAssetId?: string | null; featured?: boolean; seo?: { title?: string; description?: string } };
    output: { id: string; version: number; blocks: unknown; [key: string]: unknown };
  };
  "projects.setOutcome": {
    input: { projectId: string; label: string; value: string; unit?: string | null; method?: string | null };
    output: { id: string; projectId: string; label: string; value: string; unit: string | null; method: string | null; position: number; [key: string]: unknown };
  };
  "projects.setTaskStatus": {
    input: { id: string; status: "open" | "doing" | "blocked" | "done" | "cancelled" };
    output: { id: string; projectId: string; title: string; status: "open" | "doing" | "blocked" | "done" | "cancelled"; assigneeUserId: string | null; dueOn: string | null; position: number; doneAt: string | null; [key: string]: unknown };
  };
  "projects.setTestimonialStatus": {
    input: { id: string; status: "draft" | "published" | "withdrawn" };
    output: { id: string; projectId: string; contactId: string; displayName: string; role: string | null; body: string; rating: number | null; assetId: string | null; consentGivenAt: string; consentMethod: "contract" | "email" | "written" | "verbal" | "other"; consentNote: string | null; status: "draft" | "published" | "withdrawn"; displayLocations: string[]; [key: string]: unknown };
  };
  "projects.unlink": {
    input: { id: string };
    output: { id: string; [key: string]: unknown };
  };
  "projects.unpublish": {
    input: { id: string };
    output: { id: string; [key: string]: unknown };
  };
  "projects.unpublishCollection": {
    input: { id: string };
    output: { id: string; [key: string]: unknown };
  };
  "projects.update": {
    input: { id: string; title?: string; summary?: string | null; clientDisplayName?: string | null; status?: "enquiry" | "quoted" | "active" | "on_hold" | "complete" | "cancelled"; ownerUserId?: string | null; locationId?: string | null; serviceProductIds?: string[]; startedOn?: string | null; occurredOn?: string | null; notes?: string | null };
    output: { id: string; contactId: string | null; clientDisplayName: string | null; title: string; slug: string; summary: string | null; status: "enquiry" | "quoted" | "active" | "on_hold" | "complete" | "cancelled"; ownerUserId: string | null; locationId: string | null; serviceProductIds: string[]; startedOn: string | null; occurredOn: string | null; completedAt: string | null; notes: string | null; blocks: unknown; coverAssetId: string | null; featured: boolean; seo: unknown; publicationStatus: "draft" | "published"; publishedAt: string | null; publicPageId: string | null; clientConsentGivenAt: string | null; clientConsentMethod: ("contract" | "email" | "written" | "verbal" | "other") | null; clientConsentNote: string | null; version: number; [key: string]: unknown };
  };
  "projects.updateCaseStudySettings": {
    input: { id: string; coverAssetId?: string | null; featured: boolean; seo: { title?: string; description?: string } };
    output: { id: string; version: number; [key: string]: unknown };
  };
  "projects.updateCollection": {
    input: { id: string; name: string; kind: "portfolio" | "service" | "industry" | "season"; description?: string | null; coverAssetId?: string | null; position: number };
    output: { id: string; name: string; slug: string; kind: "portfolio" | "service" | "industry" | "season"; description: string | null; coverAssetId: string | null; position: number; publicationStatus: "draft" | "published"; publishedAt: string | null; publicPageId: string | null; [key: string]: unknown };
  };
  "proof.publishedPaths": {
    input: { locale?: string };
    output: { slug: string; title: string; updatedAt: string; kind: "article"; [key: string]: unknown }[];
  };
  "proof.seedNotice": {
    input: Record<string, never>;
    output: { id: string; created: boolean; block: unknown };
  };
  "quotes.accept": {
    input: { token: string; acceptedName: string };
    output: { id: string; reference: string; totalMinor: number };
  };
  "quotes.byPartnerToken": {
    input: { token: string };
    output: { id: string; reference: string; title: string; status: "draft" | "sent" | "viewed" | "negotiating" | "accepted" | "declined" | "expired"; version: number; currency: string; validUntil: string | null; depositMinor: number | null; terms: string | null; open: boolean; items: { id: string; quoteId: string; version: number; description: string; quantityMicros: number; unitPriceMinor: number; optional: boolean; selected: boolean; sortOrder: number; [key: string]: unknown }[]; totals: { requiredMinor: number; optionalSelectedMinor: number; optionalAvailableMinor: number; totalMinor: number }; messages: { id: string; author: "owner" | "contact"; body: string; createdAt: string; [key: string]: unknown }[]; canInvitePartner: boolean; invitedPartners: { id: string; contactName?: string; contactEmail?: string | null; [key: string]: unknown }[]; viewOnly: boolean } | null;
  };
  "quotes.byToken": {
    input: { token: string };
    output: { id: string; reference: string; title: string; status: "draft" | "sent" | "viewed" | "negotiating" | "accepted" | "declined" | "expired"; version: number; currency: string; validUntil: string | null; depositMinor: number | null; terms: string | null; open: boolean; items: { id: string; quoteId: string; version: number; description: string; quantityMicros: number; unitPriceMinor: number; optional: boolean; selected: boolean; sortOrder: number; [key: string]: unknown }[]; totals: { requiredMinor: number; optionalSelectedMinor: number; optionalAvailableMinor: number; totalMinor: number }; messages: { id: string; author: "owner" | "contact"; body: string; createdAt: string; [key: string]: unknown }[]; canInvitePartner: boolean; invitedPartners: { id: string; contactName?: string; contactEmail?: string | null; [key: string]: unknown }[]; viewOnly: boolean } | null;
  };
  "quotes.chooseOptions": {
    input: { token: string; selectedItemIds: string[] };
    output: { totals: { requiredMinor: number; optionalSelectedMinor: number; optionalAvailableMinor: number; totalMinor: number } };
  };
  "quotes.convert": {
    input: { id: string };
    output: { projectId: string | null; contractId: string | null; bookingIds: string[]; invoiceIds: string[]; skipped: string[]; [key: string]: unknown };
  };
  "quotes.create": {
    input: { contactId: string; title: string; currency?: string; validUntil?: string | null; depositMinor?: number | null; terms?: string | null; notes?: string | null };
    output: { id: string; contactId: string; reference: string; title: string; status: "draft" | "sent" | "viewed" | "negotiating" | "accepted" | "declined" | "expired"; version: number; currency: string; validUntil: string | null; depositMinor: number | null; terms: string | null; notes: string | null; sentAt: string | null; firstViewedAt: string | null; acceptedAt: string | null; declinedAt: string | null; declineReason: string | null; [key: string]: unknown };
  };
  "quotes.decline": {
    input: { token: string; reason?: string | null };
    output: { id: string };
  };
  "quotes.expire": {
    input: Record<string, never>;
    output: { expired: number };
  };
  "quotes.get": {
    input: { id: string };
    output: { id: string; contactId: string; reference: string; title: string; status: "draft" | "sent" | "viewed" | "negotiating" | "accepted" | "declined" | "expired"; version: number; currency: string; validUntil: string | null; depositMinor: number | null; terms: string | null; notes: string | null; sentAt: string | null; firstViewedAt: string | null; acceptedAt: string | null; declinedAt: string | null; declineReason: string | null; items: { id: string; quoteId: string; version: number; description: string; quantityMicros: number; unitPriceMinor: number; optional: boolean; selected: boolean; sortOrder: number; [key: string]: unknown }[]; totals: { requiredMinor: number; optionalSelectedMinor: number; optionalAvailableMinor: number; totalMinor: number }; history: { id: string; quoteId: string; version: number; description: string; quantityMicros: number; unitPriceMinor: number; optional: boolean; selected: boolean; sortOrder: number; [key: string]: unknown }[]; messages: { id: string; version: number; author: "owner" | "contact"; body: string; proposedChanges: unknown; createdAt: string; [key: string]: unknown }[]; viewToken: string | null; [key: string]: unknown } | null;
  };
  "quotes.invitePartner": {
    input: { token: string; email: string; name?: string };
    output: { id: string; quoteId: string; contactId: string; contactName?: string; contactEmail?: string | null; token: string; link: string; delivers: boolean; [key: string]: unknown };
  };
  "quotes.list": {
    input: { status?: "draft" | "sent" | "viewed" | "negotiating" | "accepted" | "declined" | "expired"; contactId?: string; limit?: number };
    output: { id: string; contactId: string; reference: string; title: string; status: "draft" | "sent" | "viewed" | "negotiating" | "accepted" | "declined" | "expired"; version: number; currency: string; validUntil: string | null; depositMinor: number | null; terms: string | null; notes: string | null; sentAt: string | null; firstViewedAt: string | null; acceptedAt: string | null; declinedAt: string | null; declineReason: string | null; contactName: string | null; contactEmail: string | null; totalMinor: number; [key: string]: unknown }[];
  };
  "quotes.loadDemoFixture": {
    input: { scenarioKey: string; scenarioVersion: number; runId: string; generation: number; locale: string; records?: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
    output: { records: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
  };
  "quotes.markViewed": {
    input: { token: string };
    output: { id: string; firstView: boolean };
  };
  "quotes.message": {
    input: { token?: string; quoteId?: string; body: string; proposedChanges?: { [key: string]: unknown } };
    output: { id: string; author: "owner" | "contact"; body: string; [key: string]: unknown };
  };
  "quotes.purgeDemoFixture": {
    input: { scenarioKey: string; scenarioVersion: number; runId: string; generation: number; locale: string; records?: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
    output: { purged: { subjectType: string; subjectId: string }[] };
  };
  "quotes.revise": {
    input: { id: string; items: { description: string; quantityMicros?: number; unitPriceMinor: number; optional?: boolean; selected?: boolean }[]; validUntil?: string | null; terms?: string | null };
    output: { id: string; contactId: string; reference: string; title: string; status: "draft" | "sent" | "viewed" | "negotiating" | "accepted" | "declined" | "expired"; version: number; currency: string; validUntil: string | null; depositMinor: number | null; terms: string | null; notes: string | null; sentAt: string | null; firstViewedAt: string | null; acceptedAt: string | null; declinedAt: string | null; declineReason: string | null; items: { id: string; quoteId: string; version: number; description: string; quantityMicros: number; unitPriceMinor: number; optional: boolean; selected: boolean; sortOrder: number; [key: string]: unknown }[]; totals: { requiredMinor: number; optionalSelectedMinor: number; optionalAvailableMinor: number; totalMinor: number }; [key: string]: unknown };
  };
  "quotes.revokePartner": {
    input: { token: string; id: string };
    output: { ok: true };
  };
  "quotes.send": {
    input: { id: string };
    output: { id: string; contactId: string; reference: string; title: string; status: "draft" | "sent" | "viewed" | "negotiating" | "accepted" | "declined" | "expired"; version: number; currency: string; validUntil: string | null; depositMinor: number | null; terms: string | null; notes: string | null; sentAt: string | null; firstViewedAt: string | null; acceptedAt: string | null; declinedAt: string | null; declineReason: string | null; viewToken: string; [key: string]: unknown };
  };
  "quotes.setConversion": {
    input: { id: string; plan: { project?: boolean; contractTemplateId?: string | null; deposit?: boolean; balance?: boolean; bookings?: { calendarId: string; startsAt: string; endsAt: string }[] } };
    output: { id: string; plan: { project: boolean; contractTemplateId: string | null; deposit: boolean; balance: boolean; bookings: { calendarId: string; startsAt: string; endsAt: string }[] }; [key: string]: unknown };
  };
  "quotes.setItems": {
    input: { id: string; items: { description: string; quantityMicros?: number; unitPriceMinor: number; optional?: boolean; selected?: boolean }[] };
    output: { items: { id: string; quoteId: string; version: number; description: string; quantityMicros: number; unitPriceMinor: number; optional: boolean; selected: boolean; sortOrder: number; [key: string]: unknown }[]; totals: { requiredMinor: number; optionalSelectedMinor: number; optionalAvailableMinor: number; totalMinor: number } };
  };
  "quotes.verifyDemoFixture": {
    input: { scenarioKey: string; scenarioVersion: number; runId: string; generation: number; locale: string; records?: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
    output: { outcomes: { key: string; achieved: boolean; detail?: string }[] };
  };
  "referrals.acceptInvitation": {
    input: { token: string; anonId?: string | null; email?: string | null; name?: string | null };
    output: { accepted: boolean; codeId: string | null; [key: string]: unknown };
  };
  "referrals.approvePayoutBatch": {
    input: { batchId: string };
    output: { batchId: string; status: "draft" | "approved" | "paid"; [key: string]: unknown };
  };
  "referrals.attributionFor": {
    input: { contactId: string; programId: string };
    output: { model: "last_touch" | "first_touch" | "position_based"; cookieWindowDays: number; touches: number; credits: { codeId: string; code: string; referrerContactId: string; share: number; [key: string]: unknown }[]; [key: string]: unknown };
  };
  "referrals.buildPayoutBatch": {
    input: { periodStart: string; periodEnd: string; currency?: string; method?: "manual" | "transfer" | "provider" };
    output: { batchId: string; lines: number; totalMinor: number; [key: string]: unknown };
  };
  "referrals.codes": {
    input: { programId?: string; contactId?: string };
    output: { id: string; programId: string; contactId: string; code: string; landingPath: string | null; clicks: number; status: "active" | "paused" | "revoked"; [key: string]: unknown }[];
  };
  "referrals.commissions": {
    input: { affiliateContactId?: string; status?: "pending" | "approved" | "paid" | "reversed"; limit?: number };
    output: { id: string; programId: string; codeId: string; affiliateContactId: string; referredContactId: string; conversionType: "signup" | "subscription" | "order" | "booking" | "custom"; subjectType: string; subjectId: string | null; sharePpm: number; basisMinor: number; amountMinor: number; currency: string; status: "pending" | "approved" | "paid" | "reversed"; payableAt: string; reversesId: string | null; payoutLineId: string | null; [key: string]: unknown }[];
  };
  "referrals.invitations": {
    input: { referrerContactId?: string };
    output: { id: string; channel: "email" | "sms" | "link" | "qr"; inviteeEmail: string | null; sentAt: string | null; acceptedAt: string | null; convertedAt: string | null; rewardState: "none" | "pending" | "granted" | "reversed"; [key: string]: unknown }[];
  };
  "referrals.invite": {
    input: { referrerContactId: string; codeId: string; channel?: "email" | "sms" | "link" | "qr"; inviteeEmail?: string | null; inviteePhone?: string | null };
    output: { id: string; token: string; [key: string]: unknown };
  };
  "referrals.issueCode": {
    input: { programId: string; contactId: string; code: string; landingPath?: string | null };
    output: { id: string; programId: string; contactId: string; code: string; landingPath: string | null; clicks: number; status: "active" | "paused" | "revoked"; [key: string]: unknown };
  };
  "referrals.markPayoutBatchPaid": {
    input: { batchId: string; paidAt?: string };
    output: { batchId: string; settled: number; [key: string]: unknown };
  };
  "referrals.payoutBatchCsv": {
    input: { batchId: string };
    output: { filename: string; csv: string; lines: number; [key: string]: unknown };
  };
  "referrals.payoutBatches": {
    input: { limit?: number };
    output: { id: string; periodStart: string; periodEnd: string; currency: string; method: "manual" | "transfer" | "provider"; status: "draft" | "approved" | "paid"; totalMinor: number; paidAt: string | null; [key: string]: unknown }[];
  };
  "referrals.payoutLines": {
    input: { batchId: string };
    output: { id: string; affiliateContactId: string; amountMinor: number; currency: string; taxFormState: "not_required" | "requested" | "collected" | "expired"; [key: string]: unknown }[];
  };
  "referrals.programs": {
    input: Record<string, never>;
    output: { id: string; name: string; conversionTypes: unknown; customerDiscount: unknown; commission: unknown; cookieWindowDays: number; holdbackDays: number; attributionModel: "last_touch" | "first_touch" | "position_based"; status: "draft" | "active" | "closed"; [key: string]: unknown }[];
  };
  "referrals.recordTouch": {
    input: { code: string; anonId?: string | null; contactId?: string | null; kind?: "click" | "scan" | "manual" | "invitation"; landingPath?: string | null; referrerUrl?: string | null; utm?: { [key: string]: string }; deviceHash?: string | null };
    output: { recorded: boolean; codeId: string | null; [key: string]: unknown };
  };
  "referrals.saveProgram": {
    input: { id?: string; name: string; conversionTypes?: ("signup" | "subscription" | "order" | "booking" | "custom")[]; customerDiscount?: { [key: string]: unknown }; commission?: { [key: string]: unknown }; cookieWindowDays?: number; holdbackDays?: number; attributionModel?: "last_touch" | "first_touch" | "position_based"; status?: "draft" | "active" | "closed" };
    output: { id: string; name: string; conversionTypes: unknown; customerDiscount: unknown; commission: unknown; cookieWindowDays: number; holdbackDays: number; attributionModel: "last_touch" | "first_touch" | "position_based"; status: "draft" | "active" | "closed"; [key: string]: unknown };
  };
  "referrals.saveTaxProfile": {
    input: { contactId: string; jurisdiction?: string; formKind?: string; state: "not_required" | "requested" | "collected" | "expired"; thresholdMinor?: number; currency?: string; note?: string };
    output: { id: string; state: "not_required" | "requested" | "collected" | "expired"; [key: string]: unknown };
  };
  "referrals.taxPrompts": {
    input: { since: string };
    output: { contactId: string; paidMinor: number; currency: string; thresholdMinor: number; state: "not_required" | "requested" | "collected" | "expired"; [key: string]: unknown }[];
  };
  "rentals.close": {
    input: { id: string; invoiceId?: string | null };
    output: { id: string; contactId: string; variantId: string; bookingId: string | null; calendarId: string; startsAt: string; dueAt: string; unit: "hour" | "day" | "week"; units: number; status: "reserved" | "out" | "overdue" | "returned" | "closed" | "cancelled"; quotedMinor: number; depositMinor: number; currency: string | null; invoiceId: string | null; pickedUpAt: string | null; returnedAt: string | null; conditionOut: string | null; conditionIn: string | null; returnCondition: ("fine" | "damaged" | "lost") | null; lateFeeMinor: number; damageFeeMinor: number; depositRefundMinor: number; notes: string | null; [key: string]: unknown };
  };
  "rentals.handOver": {
    input: { id: string; condition?: string | null };
    output: { id: string; contactId: string; variantId: string; bookingId: string | null; calendarId: string; startsAt: string; dueAt: string; unit: "hour" | "day" | "week"; units: number; status: "reserved" | "out" | "overdue" | "returned" | "closed" | "cancelled"; quotedMinor: number; depositMinor: number; currency: string | null; invoiceId: string | null; pickedUpAt: string | null; returnedAt: string | null; conditionOut: string | null; conditionIn: string | null; returnCondition: ("fine" | "damaged" | "lost") | null; lateFeeMinor: number; damageFeeMinor: number; depositRefundMinor: number; notes: string | null; [key: string]: unknown };
  };
  "rentals.list": {
    input: { status?: "reserved" | "out" | "overdue" | "returned" | "closed" | "cancelled"; contactId?: string; limit?: number };
    output: { id: string; contactId: string; variantId: string; bookingId: string | null; calendarId: string; startsAt: string; dueAt: string; unit: "hour" | "day" | "week"; units: number; status: "reserved" | "out" | "overdue" | "returned" | "closed" | "cancelled"; quotedMinor: number; depositMinor: number; currency: string | null; invoiceId: string | null; pickedUpAt: string | null; returnedAt: string | null; conditionOut: string | null; conditionIn: string | null; returnCondition: ("fine" | "damaged" | "lost") | null; lateFeeMinor: number; damageFeeMinor: number; depositRefundMinor: number; notes: string | null; sku: string; contactName: string | null; contactEmail: string | null; [key: string]: unknown }[];
  };
  "rentals.listTerms": {
    input: Record<string, never>;
    output: { id: string; variantId: string; calendarId: string; unit: "hour" | "day" | "week"; minUnits: number; maxUnits: number | null; bufferBeforeHours: number; bufferAfterHours: number; depositMinor: number; damagePolicy: "deposit_only" | "repair_cost" | "replacement"; replacementValueMinor: number; lateFeePerUnitMinor: number; conditionsBody: string | null; sku: string; calendarName: string; [key: string]: unknown }[];
  };
  "rentals.markOverdue": {
    input: Record<string, never>;
    output: { overdue: number };
  };
  "rentals.quote": {
    input: { variantId: string; startsAt: string; endsAt: string; currency?: string };
    output: { available: boolean; unit: "hour" | "day" | "week"; units: number; unitRateMinor: number; hireMinor: number; depositMinor: number; dueNowMinor: number; currency: string; reason: string | null };
  };
  "rentals.reserve": {
    input: { variantId: string; contact: { email: string; name?: string; phone?: string }; startsAt: string; endsAt: string; currency?: string; notes?: string | null };
    output: { id: string; contactId: string; variantId: string; bookingId: string | null; calendarId: string; startsAt: string; dueAt: string; unit: "hour" | "day" | "week"; units: number; status: "reserved" | "out" | "overdue" | "returned" | "closed" | "cancelled"; quotedMinor: number; depositMinor: number; currency: string | null; invoiceId: string | null; pickedUpAt: string | null; returnedAt: string | null; conditionOut: string | null; conditionIn: string | null; returnCondition: ("fine" | "damaged" | "lost") | null; lateFeeMinor: number; damageFeeMinor: number; depositRefundMinor: number; notes: string | null; [key: string]: unknown };
  };
  "rentals.setTerms": {
    input: { variantId: string; calendarId: string; unit?: "hour" | "day" | "week"; minUnits?: number; maxUnits?: number | null; bufferBeforeHours?: number; bufferAfterHours?: number; depositMinor?: number; damagePolicy?: "deposit_only" | "repair_cost" | "replacement"; replacementValueMinor?: number; lateFeePerUnitMinor?: number; conditionsBody?: string | null };
    output: { id: string; variantId: string; calendarId: string; unit: "hour" | "day" | "week"; minUnits: number; maxUnits: number | null; bufferBeforeHours: number; bufferAfterHours: number; depositMinor: number; damagePolicy: "deposit_only" | "repair_cost" | "replacement"; replacementValueMinor: number; lateFeePerUnitMinor: number; conditionsBody: string | null; [key: string]: unknown };
  };
  "rentals.takeBack": {
    input: { id: string; condition?: "fine" | "damaged" | "lost"; notes?: string | null; repairCostMinor?: number };
    output: { id: string; contactId: string; variantId: string; bookingId: string | null; calendarId: string; startsAt: string; dueAt: string; unit: "hour" | "day" | "week"; units: number; status: "reserved" | "out" | "overdue" | "returned" | "closed" | "cancelled"; quotedMinor: number; depositMinor: number; currency: string | null; invoiceId: string | null; pickedUpAt: string | null; returnedAt: string | null; conditionOut: string | null; conditionIn: string | null; returnCondition: ("fine" | "damaged" | "lost") | null; lateFeeMinor: number; damageFeeMinor: number; depositRefundMinor: number; notes: string | null; [key: string]: unknown };
  };
  "reporting.loadDemoFixture": {
    input: { scenarioKey: string; scenarioVersion: number; runId: string; generation: number; locale: string; records?: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
    output: { records: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
  };
  "reporting.purgeDemoFixture": {
    input: { scenarioKey: string; scenarioVersion: number; runId: string; generation: number; locale: string; records?: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
    output: { purged: { subjectType: string; subjectId: string }[] };
  };
  "reporting.verifyDemoFixture": {
    input: { scenarioKey: string; scenarioVersion: number; runId: string; generation: number; locale: string; records?: { fixtureKey: string; subjectType: string; subjectId: string; label: string }[] };
    output: { outcomes: { key: string; achieved: boolean; detail?: string }[] };
  };
  "reports.cohort": {
    input: { months?: number; timezone?: string; segmentId?: string };
    output: { cohorts: { cohort: string; currency: string; customers: number; cells: { monthsSince: number; amountMinor: number; customers: number; [key: string]: unknown }[]; [key: string]: unknown }[]; [key: string]: unknown };
  };
  "reports.definitions": {
    input: Record<string, never>;
    output: { reports: { key: "revenue" | "revenueBy" | "cohort" | "funnel"; labelKey: string; definitionKey: string; [key: string]: unknown }[]; dimensions: { dimension: "service" | "product" | "location"; available: boolean; basis: ("invoice" | "lines") | null; sources: { module: string; definitionKey: string; [key: string]: unknown }[]; [key: string]: unknown }[]; [key: string]: unknown };
  };
  "reports.deleteExport": {
    input: { id: string; confirm: true };
    output: { deleted: boolean; [key: string]: unknown };
  };
  "reports.deleteView": {
    input: { id: string };
    output: { deleted: boolean; [key: string]: unknown };
  };
  "reports.downloadExport": {
    input: { token: string };
    output: { filename: string; csv: string; rowCount: number; [key: string]: unknown };
  };
  "reports.exportFile": {
    input: { runId: string };
    output: { filename: string; csv: string; rowCount: number; [key: string]: unknown };
  };
  "reports.funnel": {
    input: { days?: number };
    output: unknown;
  };
  "reports.listExportRuns": {
    input: { id: string; limit?: number };
    output: { id: string; definitionId: string; definitionName: string; trigger: "schedule" | "manual"; status: "pending" | "built" | "delivered" | "failed"; periodFrom: string; periodTo: string; shape: "csv" | "quickbooks" | "xero"; basis: "paid" | "issued"; currency: string; timezone: string; rowCount: number; invoiceCount: number; totalMinor: number; refundedMinor: number; excludedCurrencies: string[]; excludedInvoiceCount: number; filename: string | null; bytes: number | null; sha256: string | null; recipients: string[]; deliveredCount: number; attempts: number; startedAt: string; deliveredAt: string | null; failedAt: string | null; error: string | null; [key: string]: unknown }[];
  };
  "reports.listExports": {
    input: Record<string, never>;
    output: { definition: { id: string; name: string; shape: "csv" | "quickbooks" | "xero"; basis: "paid" | "issued"; currency: string; period: "previous_week" | "previous_month" | "previous_quarter"; timezone: string; scheduled: boolean; recipients: string[]; dateFormat: "iso" | "dmy" | "mdy"; itemCode: string | null; accountCode: string | null; taxCode: string | null; updatedAt: string; [key: string]: unknown }; lastRun: { id: string; definitionId: string; definitionName: string; trigger: "schedule" | "manual"; status: "pending" | "built" | "delivered" | "failed"; periodFrom: string; periodTo: string; shape: "csv" | "quickbooks" | "xero"; basis: "paid" | "issued"; currency: string; timezone: string; rowCount: number; invoiceCount: number; totalMinor: number; refundedMinor: number; excludedCurrencies: string[]; excludedInvoiceCount: number; filename: string | null; bytes: number | null; sha256: string | null; recipients: string[]; deliveredCount: number; attempts: number; startedAt: string; deliveredAt: string | null; failedAt: string | null; error: string | null; [key: string]: unknown } | null; periodFrom: string; periodTo: string; due: boolean; overdue: boolean; [key: string]: unknown }[];
  };
  "reports.listViews": {
    input: Record<string, never>;
    output: { id: string; name: string; key: "revenue" | "revenueBy" | "cohort" | "funnel"; params: { [key: string]: unknown }; updatedAt: string; [key: string]: unknown }[];
  };
  "reports.queueExportRunDelivery": {
    input: { runId: string };
    output: { id: string; definitionId: string; definitionName: string; trigger: "schedule" | "manual"; status: "pending" | "built" | "delivered" | "failed"; periodFrom: string; periodTo: string; shape: "csv" | "quickbooks" | "xero"; basis: "paid" | "issued"; currency: string; timezone: string; rowCount: number; invoiceCount: number; totalMinor: number; refundedMinor: number; excludedCurrencies: string[]; excludedInvoiceCount: number; filename: string | null; bytes: number | null; sha256: string | null; recipients: string[]; deliveredCount: number; attempts: number; startedAt: string; deliveredAt: string | null; failedAt: string | null; error: string | null; [key: string]: unknown };
  };
  "reports.revenue": {
    input: { days?: number; timezone?: string };
    output: { from: string; to: string; months: { month: string; currency: string; amountMinor: number; paidMinor: number; refundedMinor: number; invoices: number; [key: string]: unknown }[]; totals: { currency: string; amountMinor: number; [key: string]: unknown }[]; [key: string]: unknown };
  };
  "reports.revenueBy": {
    input: { dimension: "service" | "product" | "location"; days?: number; limit?: number };
    output: { dimension: "service" | "product" | "location"; basis: "invoice" | "lines"; from: string; to: string; buckets: { bucket: string; currency: string; amountMinor: number; [key: string]: unknown }[]; [key: string]: unknown };
  };
  "reports.runExport": {
    input: { id: string; trigger?: "schedule" | "manual" };
    output: { id: string; definitionId: string; definitionName: string; trigger: "schedule" | "manual"; status: "pending" | "built" | "delivered" | "failed"; periodFrom: string; periodTo: string; shape: "csv" | "quickbooks" | "xero"; basis: "paid" | "issued"; currency: string; timezone: string; rowCount: number; invoiceCount: number; totalMinor: number; refundedMinor: number; excludedCurrencies: string[]; excludedInvoiceCount: number; filename: string | null; bytes: number | null; sha256: string | null; recipients: string[]; deliveredCount: number; attempts: number; startedAt: string; deliveredAt: string | null; failedAt: string | null; error: string | null; [key: string]: unknown };
  };
  "reports.saveExport": {
    input: { id?: string; name: string; shape: "csv" | "quickbooks" | "xero"; basis?: "paid" | "issued"; currency: string; period?: "previous_week" | "previous_month" | "previous_quarter"; timezone?: string; scheduled?: boolean; recipients?: string[]; dateFormat?: "iso" | "dmy" | "mdy"; itemCode?: string | null; accountCode?: string | null; taxCode?: string | null };
    output: { id: string; name: string; shape: "csv" | "quickbooks" | "xero"; basis: "paid" | "issued"; currency: string; period: "previous_week" | "previous_month" | "previous_quarter"; timezone: string; scheduled: boolean; recipients: string[]; dateFormat: "iso" | "dmy" | "mdy"; itemCode: string | null; accountCode: string | null; taxCode: string | null; updatedAt: string; [key: string]: unknown };
  };
  "reports.saveView": {
    input: { id?: string; name: string; key: "revenue" | "revenueBy" | "cohort" | "funnel"; params?: { [key: string]: unknown } };
    output: { id: string; name: string; key: "revenue" | "revenueBy" | "cohort" | "funnel"; params: { [key: string]: unknown }; updatedAt: string; [key: string]: unknown };
  };
  "reviews.aggregate": {
    input: { subjectType?: "business" | "product" | "service"; subjectId?: string | null };
    output: { ratingValue: number | null; reviewCount: number; displayedCount: number; withheld: boolean; [key: string]: unknown };
  };
  "reviews.ingestExternal": {
    input: { source: "post_order" | "post_booking" | "manual" | "google_business"; rating: number; body?: string; displayName?: string | null; email?: string | null };
    output: { id: string; contactId: string | null; displayName: string | null; source: "post_order" | "post_booking" | "manual" | "google_business"; subjectType: "business" | "product" | "service"; subjectId: string | null; rating: number; title: string | null; body: string; status: "pending" | "approved" | "hidden" | "rejected"; displayLocations: string[]; replyBody: string | null; replyAt: string | null; incentiveDisclosed: boolean; createdAt: string; [key: string]: unknown };
  };
  "reviews.list": {
    input: { status?: "pending" | "approved" | "hidden" | "rejected"; limit?: number };
    output: { id: string; contactId: string | null; displayName: string | null; source: "post_order" | "post_booking" | "manual" | "google_business"; subjectType: "business" | "product" | "service"; subjectId: string | null; rating: number; title: string | null; body: string; status: "pending" | "approved" | "hidden" | "rejected"; displayLocations: string[]; replyBody: string | null; replyAt: string | null; incentiveDisclosed: boolean; createdAt: string; [key: string]: unknown }[];
  };
  "reviews.moderate": {
    input: { id: string; status: "approved" | "hidden" | "rejected"; displayLocations?: string[] };
    output: { id: string; contactId: string | null; displayName: string | null; source: "post_order" | "post_booking" | "manual" | "google_business"; subjectType: "business" | "product" | "service"; subjectId: string | null; rating: number; title: string | null; body: string; status: "pending" | "approved" | "hidden" | "rejected"; displayLocations: string[]; replyBody: string | null; replyAt: string | null; incentiveDisclosed: boolean; createdAt: string; [key: string]: unknown };
  };
  "reviews.published": {
    input: { subjectType?: "business" | "product" | "service"; subjectId?: string | null; location?: string; limit?: number };
    output: { id: string; displayName: string | null; source: "post_order" | "post_booking" | "manual" | "google_business"; subjectType: "business" | "product" | "service"; subjectId: string | null; rating: number; title: string | null; body: string; status: "pending" | "approved" | "hidden" | "rejected"; displayLocations: string[]; replyBody: string | null; replyAt: string | null; incentiveDisclosed: boolean; createdAt: string; assetIds: string[]; [key: string]: unknown }[];
  };
  "reviews.reply": {
    input: { id: string; body: string };
    output: { id: string; contactId: string | null; displayName: string | null; source: "post_order" | "post_booking" | "manual" | "google_business"; subjectType: "business" | "product" | "service"; subjectId: string | null; rating: number; title: string | null; body: string; status: "pending" | "approved" | "hidden" | "rejected"; displayLocations: string[]; replyBody: string | null; replyAt: string | null; incentiveDisclosed: boolean; createdAt: string; [key: string]: unknown };
  };
  "reviews.request": {
    input: { email: string; name?: string; source?: "post_order" | "post_booking" | "manual" | "google_business"; subjectType?: "business" | "product" | "service"; subjectId?: string | null; incentiveCouponId?: string | null; expiresAt?: string | null };
    output: { id: string; contactId: string; token: string; alreadyAsked: boolean; [key: string]: unknown };
  };
  "reviews.submit": {
    input: { token: string; rating: number; title?: string | null; body: string; displayName?: string | null; assetIds?: string[] };
    output: { id: string; contactId: string | null; displayName: string | null; source: "post_order" | "post_booking" | "manual" | "google_business"; subjectType: "business" | "product" | "service"; subjectId: string | null; rating: number; title: string | null; body: string; status: "pending" | "approved" | "hidden" | "rejected"; displayLocations: string[]; replyBody: string | null; replyAt: string | null; incentiveDisclosed: boolean; createdAt: string; [key: string]: unknown };
  };
  "roles.assign": {
    input: { userId: string; roleKey: string };
    output: { userId: string; role: string };
  };
  "roles.create": {
    input: { name: string; key?: string; description?: string; grants?: { module: string; access: "view" | "manage" }[] };
    output: { key: string };
  };
  "roles.delete": {
    input: { key: string };
    output: { key: string };
  };
  "roles.list": {
    input: Record<string, never>;
    output: { key: string; name: string; description: string; isSystem: boolean; assignable: boolean; createdAt: string; updatedAt: string; grants: { module: string; access: "view" | "manage"; [key: string]: unknown }[]; users: number; [key: string]: unknown }[];
  };
  "roles.modules": {
    input: Record<string, never>;
    output: { module: string; queries: number; mutations: number; [key: string]: unknown }[];
  };
  "roles.update": {
    input: { key: string; name: string; description?: string; grants: { module: string; access: "view" | "manage" }[] };
    output: { key: string };
  };
  "roles.users": {
    input: Record<string, never>;
    output: { id: string; email: string; role: string; lastLoginAt: string | null; [key: string]: unknown }[];
  };
  "scheduling.slots": {
    input: { serviceOfferingId: string; productId: string; from: string; to: string; preferredCalendarId?: string; seats?: number; granularityMin?: number; limit?: number; audienceToken?: string };
    output: { startsAt: string; endsAt: string; calendarId: string; calendarName: string; resourceCalendarIds: string[]; seatsAvailable: number }[];
  };
  "scoring.advance": {
    input: { contactId: string; stage: "lead" | "prospect" | "customer" | "repeat" };
    output: { moved: boolean; [key: string]: unknown };
  };
  "scoring.applyThresholds": {
    input: { contactId: string };
    output: { score: number; [key: string]: unknown };
  };
  "scoring.award": {
    input: { contactId: string; reason: string; points: number; decayDays?: number };
    output: { id: string; score: number; [key: string]: unknown };
  };
  "scoring.for": {
    input: { contactId: string };
    output: { score: number; [key: string]: unknown };
  };
  "scoring.removeRule": {
    input: { id: string };
    output: { id: string; [key: string]: unknown };
  };
  "scoring.rules": {
    input: Record<string, never>;
    output: { id: string; name: string; kind: "event" | "threshold"; eventName: string | null; matchPayload: unknown; points: number; decayDays: number; maxAwards: number | null; advanceTo: ("lead" | "prospect" | "customer" | "repeat") | null; thresholdScore: number | null; active: boolean; [key: string]: unknown }[];
  };
  "scoring.saveRule": {
    input: { id?: string; name: string; kind?: "event" | "threshold"; eventName?: string | null; matchPayload?: { [key: string]: string | number | boolean }; points?: number; decayDays?: number; maxAwards?: number | null; advanceTo?: ("lead" | "prospect" | "customer" | "repeat") | null; thresholdScore?: number | null; active?: boolean };
    output: { id: string; name: string; kind: "event" | "threshold"; eventName: string | null; matchPayload: unknown; points: number; decayDays: number; maxAwards: number | null; advanceTo: ("lead" | "prospect" | "customer" | "repeat") | null; thresholdScore: number | null; active: boolean; [key: string]: unknown };
  };
  "scoring.why": {
    input: { contactId: string; limit?: number };
    output: { score: number; awards: { id: string; ruleName: string; eventName: string; points: number; remaining: number; decayDays: number; daysLeft: number | null; occurredAt: string; [key: string]: unknown }[]; [key: string]: unknown };
  };
  "seed.installPreset": {
    input: { preset: "creator" | "service-business" | "shop"; locale?: string };
    output: { preset: "creator" | "service-business" | "shop"; pages: string[]; entities: string[]; emails: string[]; tokensApplied: boolean };
  };
  "segments.capture": {
    input: { id: string };
    output: { id: string; count: number; capturedAt: string; [key: string]: unknown };
  };
  "segments.contains": {
    input: { id?: string; slug?: string; contactId: string };
    output: { member: boolean; [key: string]: unknown };
  };
  "segments.fields": {
    input: Record<string, never>;
    output: { key: string; label: string; type: string; source: string; options: string[] | null; operators: string[]; [key: string]: unknown }[];
  };
  "segments.list": {
    input: { kind?: "dynamic" | "static" };
    output: { id: string; name: string; slug: string; description: string | null; kind: "dynamic" | "static"; definition: unknown; memberCountCached: number | null; lastEvaluatedAt: string | null; capturedAt: string | null; [key: string]: unknown }[];
  };
  "segments.members": {
    input: { id?: string; slug?: string; limit?: number };
    output: { id: string; name: string; email: string | null; [key: string]: unknown }[];
  };
  "segments.preview": {
    input: { definition: { match?: "all" | "any"; rules: { field: string; op: "is" | "isNot" | "isOneOf" | "contains" | "before" | "after" | "inLastDays" | "atLeast" | "atMost" | "isSet" | "isNotSet"; value?: unknown }[] }; sample?: number };
    output: { count: number; sample: { id: string; name: string; email: string | null; [key: string]: unknown }[]; [key: string]: unknown };
  };
  "segments.remove": {
    input: { id: string };
    output: { id: string; [key: string]: unknown };
  };
  "segments.save": {
    input: { id?: string; name: string; slug?: string; description?: string | null; kind?: "dynamic" | "static"; definition: { match?: "all" | "any"; rules: { field: string; op: "is" | "isNot" | "isOneOf" | "contains" | "before" | "after" | "inLastDays" | "atLeast" | "atMost" | "isSet" | "isNotSet"; value?: unknown }[] } };
    output: { id: string; name: string; slug: string; description: string | null; kind: "dynamic" | "static"; definition: unknown; memberCountCached: number | null; lastEvaluatedAt: string | null; capturedAt: string | null; [key: string]: unknown };
  };
  "segments.why": {
    input: { id?: string; slug?: string; contactId: string };
    output: { member: boolean; match: "all" | "any"; reasons: { field: string; label: string; op: string; value: string; passed: boolean; [key: string]: unknown }[]; [key: string]: unknown };
  };
  "seo.deleteRedirect": {
    input: { id: string };
    output: { ok: true };
  };
  "seo.listRedirects": {
    input: Record<string, never>;
    output: { id: string; fromPath: string; toPath: string; status: "301" | "302"; locale: string; source: string; createdAt: string; updatedAt: string; [key: string]: unknown }[];
  };
  "seo.recordRedirect": {
    input: { fromPath: string; toPath: string; locale?: string; status?: "301" | "302"; source?: string };
    output: { id: string; fromPath: string; toPath: string; status: "301" | "302"; locale: string; source: string; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "seo.resolveRedirect": {
    input: { path: string; locale?: string };
    output: { toPath: string; status: "301" | "302"; [key: string]: unknown } | null;
  };
  "settings.completeSetup": {
    input: Record<string, never>;
    output: { id: number; name: string; tagline: string | null; schemaType: string; country: string; defaultLocale: string; enabledLocales: string[]; baseCurrency: string; timezone: string; units: "metric" | "imperial"; firstDayOfWeek: number; setupCompletedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "settings.finishSetupAsOwner": {
    input: Record<string, never>;
    output: { id: number; name: string; tagline: string | null; schemaType: string; country: string; defaultLocale: string; enabledLocales: string[]; baseCurrency: string; timezone: string; units: "metric" | "imperial"; firstDayOfWeek: number; setupCompletedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "settings.getBusiness": {
    input: Record<string, never>;
    output: { id: number; name: string; tagline: string | null; schemaType: string; country: string; defaultLocale: string; enabledLocales: string[]; baseCurrency: string; timezone: string; units: "metric" | "imperial"; firstDayOfWeek: number; setupCompletedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown } | null;
  };
  "settings.getDesign": {
    input: Record<string, never>;
    output: { theme: { light: { paper: string; surface: string; surfaceMuted: string; field: string; ink: string; inkMuted: string; rule: string; accent: string; onAccent: string; accentSoft: string; success: string; successSoft: string; warning: string; warningSoft: string; danger: string; dangerSoft: string; focus: string }; dark: { paper: string; surface: string; surfaceMuted: string; field: string; ink: string; inkMuted: string; rule: string; accent: string; onAccent: string; accentSoft: string; success: string; successSoft: string; warning: string; warningSoft: string; danger: string; dangerSoft: string; focus: string } }; extras: { fontSans?: string; fontMono?: string; radius?: string; motion?: string; measure?: string; gutter?: string }; logoAssetId: string | null; origin: "owner" | "system" };
  };
  "settings.getModuleConfig": {
    input: { module: string };
    output: { [key: string]: unknown };
  };
  "settings.listModules": {
    input: Record<string, never>;
    output: { module: string; enabled: boolean; config: unknown; updatedAt: string; [key: string]: unknown }[];
  };
  "settings.patchBusiness": {
    input: { name?: string; tagline?: string; schemaType?: string; country?: string; defaultLocale?: string; enabledLocales?: string[]; baseCurrency?: string; timezone?: string; units?: "metric" | "imperial"; firstDayOfWeek?: number };
    output: { id: number; name: string; tagline: string | null; schemaType: string; country: string; defaultLocale: string; enabledLocales: string[]; baseCurrency: string; timezone: string; units: "metric" | "imperial"; firstDayOfWeek: number; setupCompletedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "settings.resetDesign": {
    input: Record<string, never>;
    output: { theme: { light: { paper: string; surface: string; surfaceMuted: string; field: string; ink: string; inkMuted: string; rule: string; accent: string; onAccent: string; accentSoft: string; success: string; successSoft: string; warning: string; warningSoft: string; danger: string; dangerSoft: string; focus: string }; dark: { paper: string; surface: string; surfaceMuted: string; field: string; ink: string; inkMuted: string; rule: string; accent: string; onAccent: string; accentSoft: string; success: string; successSoft: string; warning: string; warningSoft: string; danger: string; dangerSoft: string; focus: string } }; extras: { fontSans?: string; fontMono?: string; radius?: string; motion?: string; measure?: string; gutter?: string }; logoAssetId: string | null; origin: "owner" | "system" };
  };
  "settings.saveSetupBusiness": {
    input: { name: string; tagline?: string; schemaType?: string; country: string; defaultLocale?: string; enabledLocales?: string[]; baseCurrency: string; timezone: string; units?: "metric" | "imperial"; firstDayOfWeek?: number };
    output: { id: number; name: string; tagline: string | null; schemaType: string; country: string; defaultLocale: string; enabledLocales: string[]; baseCurrency: string; timezone: string; units: "metric" | "imperial"; firstDayOfWeek: number; setupCompletedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "settings.setModuleConfig": {
    input: { module: string; config: { [key: string]: unknown } };
    output: { module: string; enabled: boolean; config: unknown; updatedAt: string; [key: string]: unknown };
  };
  "settings.setModuleEnabled": {
    input: { module: string; enabled: boolean };
    output: { module: string; enabled: boolean; config: unknown; updatedAt: string; [key: string]: unknown };
  };
  "settings.setupState": {
    input: Record<string, never>;
    output: { hasOwner: boolean; hasBusiness: boolean; completed: boolean };
  };
  "settings.updateBusiness": {
    input: { name: string; tagline?: string; schemaType?: string; country: string; defaultLocale?: string; enabledLocales?: string[]; baseCurrency: string; timezone: string; units?: "metric" | "imperial"; firstDayOfWeek?: number };
    output: { id: number; name: string; tagline: string | null; schemaType: string; country: string; defaultLocale: string; enabledLocales: string[]; baseCurrency: string; timezone: string; units: "metric" | "imperial"; firstDayOfWeek: number; setupCompletedAt: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "settings.updateDesign": {
    input: { colors?: { light?: { paper?: string; surface?: string; surfaceMuted?: string; field?: string; ink?: string; inkMuted?: string; rule?: string; accent?: string; onAccent?: string; accentSoft?: string; success?: string; successSoft?: string; warning?: string; warningSoft?: string; danger?: string; dangerSoft?: string; focus?: string }; dark?: { paper?: string; surface?: string; surfaceMuted?: string; field?: string; ink?: string; inkMuted?: string; rule?: string; accent?: string; onAccent?: string; accentSoft?: string; success?: string; successSoft?: string; warning?: string; warningSoft?: string; danger?: string; dangerSoft?: string; focus?: string } }; fontSans?: string | null; fontMono?: string | null; radius?: ("0.25rem" | "0.375rem" | "0.5rem" | "0.75rem") | null; motion?: ("120ms" | "180ms" | "0.01ms") | null; measure?: ("36rem" | "48rem" | "56rem") | null; gutter?: ("1rem" | "1.5rem" | "2rem") | null; logoAssetId?: string | null };
    output: { theme: { light: { paper: string; surface: string; surfaceMuted: string; field: string; ink: string; inkMuted: string; rule: string; accent: string; onAccent: string; accentSoft: string; success: string; successSoft: string; warning: string; warningSoft: string; danger: string; dangerSoft: string; focus: string }; dark: { paper: string; surface: string; surfaceMuted: string; field: string; ink: string; inkMuted: string; rule: string; accent: string; onAccent: string; accentSoft: string; success: string; successSoft: string; warning: string; warningSoft: string; danger: string; dangerSoft: string; focus: string } }; extras: { fontSans?: string; fontMono?: string; radius?: string; motion?: string; measure?: string; gutter?: string }; logoAssetId: string | null; origin: "owner" | "system" };
  };
  "share.embedSnippet": {
    input: { kind: "reviews" | "booking" | "newsletter" | "gallery"; id?: string };
    output: { kind: "reviews" | "booking" | "newsletter" | "gallery"; src: string; backlink: string; html: string; title: string };
  };
  "share.forgetTarget": {
    input: { id: string; confirm: true };
    output: { ok: true };
  };
  "share.linkReport": {
    input: { days?: number; limit?: number };
    output: { id: string; ref: string; url: string; channel: string; path: string; entityKind: string; shareable: boolean; sharerContactId: string | null; sharerName: string | null; createdAt: string; visitors: number; conversions: number; [key: string]: unknown }[];
  };
  "share.resolveLink": {
    input: { ref: string };
    output: { destination: string; channel: string; path: string; [key: string]: unknown } | null;
  };
  "share.saveTarget": {
    input: { path: string; locale?: string; entityKind?: string; shareable?: boolean; channels?: ("link" | "native" | "email" | "sms" | "whatsapp" | "facebook" | "x" | "linkedin" | "reddit" | "telegram")[]; socialTitle?: string | null; socialDescription?: string | null; imageUrl?: string | null };
    output: { id: string; entityKind: string; path: string; locale: string; shareable: boolean; channels: string[] | null; socialTitle: string | null; socialDescription: string | null; imageUrl: string | null; shares: number; updatedAt: string; [key: string]: unknown };
  };
  "share.shareVia": {
    input: { path: string; locale?: string; channel: "link" | "native" | "email" | "sms" | "whatsapp" | "facebook" | "x" | "linkedin" | "reddit" | "telegram"; title?: string };
    output: { ref: string; url: string; canonicalUrl: string; channel: string; intentUrl: string | null; text: string; [key: string]: unknown };
  };
  "share.targetFor": {
    input: { path: string; locale?: string };
    output: { id: string | null; entityKind: string; path: string; locale: string; shareable: boolean; channels: string[]; socialTitle: string | null; socialDescription: string | null; imageUrl: string | null; canonicalUrl: string | null; [key: string]: unknown };
  };
  "share.targets": {
    input: Record<string, never>;
    output: { id: string; entityKind: string; path: string; locale: string; shareable: boolean; channels: string[] | null; socialTitle: string | null; socialDescription: string | null; imageUrl: string | null; shares: number; updatedAt: string; [key: string]: unknown }[];
  };
  "signupContactImports.beginOAuth": {
    input: { provider: "google" | "microsoft" };
    output: { authorizationUrl: string; [key: string]: unknown };
  };
  "signupContactImports.commit": {
    input: { id: string };
    output: { id: string; filename: string; sourceKind: "owner_csv" | "google" | "microsoft" | "vcard" | "csv" | "device"; signupFlow: "portal_account" | null; allowedFields: string[]; status: "mapping" | "validated" | "committed" | "reverted" | "failed"; counts: unknown; committedAt: string | null; revertedAt: string | null; createdAt: string; [key: string]: unknown };
  };
  "signupContactImports.completeOAuth": {
    input: { provider: "google" | "microsoft"; state: string; code: string };
    output: { connectedAccountId: string; provider: "google" | "microsoft"; email: string | null; returnTo: string; [key: string]: unknown };
  };
  "signupContactImports.disconnect": {
    input: { accountId: string };
    output: { disconnected: true; [key: string]: unknown };
  };
  "signupContactImports.get": {
    input: { id: string };
    output: { id: string; filename: string; sourceKind: "owner_csv" | "google" | "microsoft" | "vcard" | "csv" | "device"; signupFlow: "portal_account" | null; allowedFields: string[]; status: "mapping" | "validated" | "committed" | "reverted" | "failed"; counts: unknown; committedAt: string | null; revertedAt: string | null; createdAt: string; headers: string[]; mapping: string[]; rows: { id: string; lineNumber: number; cells: string[]; email: string | null; outcome: "create" | "update" | "unchanged" | "skip" | "error"; errors: string[]; changes: unknown; contactId: string | null; created: boolean; relationshipId: string | null; [key: string]: unknown }[]; [key: string]: unknown };
  };
  "signupContactImports.getOffer": {
    input: { flow?: "portal_account" };
    output: { enabled: boolean; allowedSources: ("google" | "microsoft" | "vcard" | "csv" | "device")[]; allowedFields: ("email" | "name" | "phone")[]; maxContacts: number; decision: ("pending" | "skipped" | "completed") | null; batches: { id: string; filename: string; sourceKind: "owner_csv" | "google" | "microsoft" | "vcard" | "csv" | "device"; signupFlow: "portal_account" | null; allowedFields: string[]; status: "mapping" | "validated" | "committed" | "reverted" | "failed"; counts: unknown; committedAt: string | null; revertedAt: string | null; createdAt: string; [key: string]: unknown }[]; connections: { id: string; provider: "google" | "microsoft"; email: string | null; [key: string]: unknown }[]; [key: string]: unknown };
  };
  "signupContactImports.getPolicy": {
    input: { flow?: "portal_account" };
    output: { flow: "portal_account"; enabled: boolean; allowedSources: ("google" | "microsoft" | "vcard" | "csv" | "device")[]; allowedFields: ("email" | "name" | "phone")[]; maxContacts: number; updatedBy: string | null; createdAt: string; updatedAt: string; [key: string]: unknown } | null;
  };
  "signupContactImports.listProviderContacts": {
    input: { accountId: string };
    output: { provider: "google" | "microsoft"; fields: ("email" | "name" | "phone")[]; maxContacts: number; contacts: { externalId: string; name: string | null; email: string | null; phone: string | null; [key: string]: unknown }[]; [key: string]: unknown };
  };
  "signupContactImports.revert": {
    input: { id: string };
    output: { id: string; restored: number; deleted: number; kept: number; [key: string]: unknown };
  };
  "signupContactImports.setPolicy": {
    input: { flow?: "portal_account"; enabled: boolean; allowedSources: ("google" | "microsoft" | "vcard" | "csv" | "device")[]; allowedFields: ("email" | "name" | "phone")[]; maxContacts: number };
    output: { flow: "portal_account"; enabled: boolean; allowedSources: ("google" | "microsoft" | "vcard" | "csv" | "device")[]; allowedFields: ("email" | "name" | "phone")[]; maxContacts: number; updatedBy: string | null; createdAt: string; updatedAt: string; [key: string]: unknown };
  };
  "signupContactImports.skip": {
    input: { id?: string };
    output: { skipped: true; [key: string]: unknown };
  };
  "signupContactImports.stageDevice": {
    input: { contacts: { name?: string | null; email?: string | null; phone?: string | null }[]; fields: ("email" | "name" | "phone")[] };
    output: { id: string; filename: string; sourceKind: "owner_csv" | "google" | "microsoft" | "vcard" | "csv" | "device"; signupFlow: "portal_account" | null; allowedFields: string[]; status: "mapping" | "validated" | "committed" | "reverted" | "failed"; counts: unknown; committedAt: string | null; revertedAt: string | null; createdAt: string; headers: string[]; mapping: string[]; rows: { id: string; lineNumber: number; cells: string[]; email: string | null; outcome: "create" | "update" | "unchanged" | "skip" | "error"; errors: string[]; changes: unknown; contactId: string | null; created: boolean; relationshipId: string | null; [key: string]: unknown }[]; [key: string]: unknown };
  };
  "signupContactImports.stageFile": {
    input: { source: "csv" | "vcard"; filename: string; content: string; fields: ("email" | "name" | "phone")[] };
    output: { id: string; filename: string; sourceKind: "owner_csv" | "google" | "microsoft" | "vcard" | "csv" | "device"; signupFlow: "portal_account" | null; allowedFields: string[]; status: "mapping" | "validated" | "committed" | "reverted" | "failed"; counts: unknown; committedAt: string | null; revertedAt: string | null; createdAt: string; headers: string[]; mapping: string[]; rows: { id: string; lineNumber: number; cells: string[]; email: string | null; outcome: "create" | "update" | "unchanged" | "skip" | "error"; errors: string[]; changes: unknown; contactId: string | null; created: boolean; relationshipId: string | null; [key: string]: unknown }[]; [key: string]: unknown };
  };
  "signupContactImports.stageProvider": {
    input: { accountId: string; externalIds: string[] };
    output: { id: string; filename: string; sourceKind: "owner_csv" | "google" | "microsoft" | "vcard" | "csv" | "device"; signupFlow: "portal_account" | null; allowedFields: string[]; status: "mapping" | "validated" | "committed" | "reverted" | "failed"; counts: unknown; committedAt: string | null; revertedAt: string | null; createdAt: string; headers: string[]; mapping: string[]; rows: { id: string; lineNumber: number; cells: string[]; email: string | null; outcome: "create" | "update" | "unchanged" | "skip" | "error"; errors: string[]; changes: unknown; contactId: string | null; created: boolean; relationshipId: string | null; [key: string]: unknown }[]; [key: string]: unknown };
  };
  "social.assignProfile": {
    input: { id: string; assignedTo: "user" | "business" | "locations"; assigneeUserId?: string | null; locationIds?: string[] };
    output: { id: string; provider: string; providerAccountId: string; displayName: string; handle: string | null; status: "pending_review" | "active" | "needs_reconnect" | "revoked"; assignedTo: "user" | "business" | "locations"; assigneeUserId: string | null; locationIds: string[]; allowRead: boolean; allowRespond: boolean; allowPublish: boolean; approvalPolicy: "none" | "required"; capabilities: { read: boolean; respond: boolean; publish: boolean; extras: string[] }; tokenExpiresAt: string | null; lastHealthAt: string | null; lastHealthStatus: ("ok" | "expiring" | "expired" | "error") | null; lastError: string | null; createdAt: string; [key: string]: unknown };
  };
  "social.attributionReport": {
    input: { days?: number };
    output: { source: string; campaign: string | null; visitors: number; contacts: number; conversions: number; revenueMinor: number; [key: string]: unknown }[];
  };
  "social.beginOAuth": {
    input: { provider: string; returnTo?: string };
    output: { authorizationUrl: string };
  };
  "social.checkHealth": {
    input: { id?: string };
    output: { queued: number; jobIds: string[] };
  };
  "social.completeOAuth": {
    input: { provider: string; state: string; code: string };
    output: { id: string; provider: string; displayName: string; status: "pending_review"; returnTo: string };
  };
  "social.composePackage": {
    input: { body?: string; assetIds?: string[]; locale?: string };
    output: { id: string; contentDigest: string; [key: string]: unknown };
  };
  "social.createVariants": {
    input: { packageId: string; profileIds: string[]; caption?: string };
    output: { id: string; packageId: string; profileId: string; caption: string; hashtags: string[]; assetIds: string[]; aspectRatio: "1:1" | "4:5" | "9:16" | "16:9"; generated: boolean; status: "draft" | "pending_review" | "approved" | "rejected"; createdAt: string; [key: string]: unknown }[];
  };
  "social.disconnectProfile": {
    input: { id: string };
    output: { ok: true };
  };
  "social.draftFromPackage": {
    input: { id: string };
    output: { id: string; sourceKind: "ingest" | "authored" | "draft"; sourceProfileId: string | null; sourceProvider: string | null; sourceRef: string | null; contentDigest: string; parentPackageId: string | null; body: string; rights: "owned" | "licensed" | "unknown"; canonicalUrl: string | null; assetIds: string[]; createdAt: string; [key: string]: unknown };
  };
  "social.ingestProfile": {
    input: { profileId: string };
    output: { profileId: string; jobId: string; queued: true; [key: string]: unknown };
  };
  "social.interactionList": {
    input: { packageId?: string };
    output: { id: string; packageId: string; kind: "comment" | "mention"; body: string; authorHandle: string; authorEmail: string | null; contactId: string | null; conversationId: string | null; occurredAt: string; [key: string]: unknown }[];
  };
  "social.networks": {
    input: Record<string, never>;
    output: { id: string; label: string; available: boolean; message: string; pkce: boolean; capabilities: { read: boolean; respond: boolean; publish: boolean; extras: string[] }; [key: string]: unknown }[];
  };
  "social.packageList": {
    input: Record<string, never>;
    output: { id: string; sourceKind: "ingest" | "authored" | "draft"; sourceProfileId: string | null; sourceProvider: string | null; sourceRef: string | null; contentDigest: string; parentPackageId: string | null; body: string; rights: "owned" | "licensed" | "unknown"; canonicalUrl: string | null; assetIds: string[]; createdAt: string; [key: string]: unknown }[];
  };
  "social.profiles": {
    input: Record<string, never>;
    output: { id: string; provider: string; providerAccountId: string; displayName: string; handle: string | null; status: "pending_review" | "active" | "needs_reconnect" | "revoked"; assignedTo: "user" | "business" | "locations"; assigneeUserId: string | null; locationIds: string[]; allowRead: boolean; allowRespond: boolean; allowPublish: boolean; approvalPolicy: "none" | "required"; capabilities: { read: boolean; respond: boolean; publish: boolean; extras: string[] }; tokenExpiresAt: string | null; lastHealthAt: string | null; lastHealthStatus: ("ok" | "expiring" | "expired" | "error") | null; lastError: string | null; createdAt: string; [key: string]: unknown }[];
  };
  "social.publicationCalendar": {
    input: { from?: string; to?: string };
    output: { id: string; packageId: string; variantId: string | null; profileId: string | null; provider: string; providerRef: string | null; status: "ingested" | "drafted" | "scheduled" | "published" | "failed"; scheduledAt: string | null; publishedAt: string | null; lastError: string | null; canonicalUrl: string | null; createdAt: string; [key: string]: unknown }[];
  };
  "social.publishDue": {
    input: Record<string, never>;
    output: { queued: number; jobIds: string[] };
  };
  "social.reviewProfile": {
    input: { id: string; approved: boolean };
    output: { id: string; provider: string; providerAccountId: string; displayName: string; handle: string | null; status: "pending_review" | "active" | "needs_reconnect" | "revoked"; assignedTo: "user" | "business" | "locations"; assigneeUserId: string | null; locationIds: string[]; allowRead: boolean; allowRespond: boolean; allowPublish: boolean; approvalPolicy: "none" | "required"; capabilities: { read: boolean; respond: boolean; publish: boolean; extras: string[] }; tokenExpiresAt: string | null; lastHealthAt: string | null; lastHealthStatus: ("ok" | "expiring" | "expired" | "error") | null; lastError: string | null; createdAt: string; [key: string]: unknown };
  };
  "social.reviewVariant": {
    input: { id: string; approved: boolean };
    output: { id: string; packageId: string; profileId: string; caption: string; hashtags: string[]; assetIds: string[]; aspectRatio: "1:1" | "4:5" | "9:16" | "16:9"; generated: boolean; status: "draft" | "pending_review" | "approved" | "rejected"; createdAt: string; [key: string]: unknown };
  };
  "social.schedulePublications": {
    input: { variantIds: string[]; publishAt?: string };
    output: { id: string; packageId: string; variantId: string | null; profileId: string | null; provider: string; providerRef: string | null; status: "ingested" | "drafted" | "scheduled" | "published" | "failed"; scheduledAt: string | null; publishedAt: string | null; lastError: string | null; canonicalUrl: string | null; createdAt: string; [key: string]: unknown }[];
  };
  "social.setPolicy": {
    input: { id: string; allowRead: boolean; allowRespond: boolean; allowPublish: boolean; approvalPolicy: "none" | "required" };
    output: { id: string; provider: string; providerAccountId: string; displayName: string; handle: string | null; status: "pending_review" | "active" | "needs_reconnect" | "revoked"; assignedTo: "user" | "business" | "locations"; assigneeUserId: string | null; locationIds: string[]; allowRead: boolean; allowRespond: boolean; allowPublish: boolean; approvalPolicy: "none" | "required"; capabilities: { read: boolean; respond: boolean; publish: boolean; extras: string[] }; tokenExpiresAt: string | null; lastHealthAt: string | null; lastHealthStatus: ("ok" | "expiring" | "expired" | "error") | null; lastError: string | null; createdAt: string; [key: string]: unknown };
  };
  "social.staffMembers": {
    input: Record<string, never>;
    output: { id: string; email: string; [key: string]: unknown }[];
  };
  "social.syncGbp": {
    input: { profileId: string };
    output: { profileId: string; jobId: string; queued: true; [key: string]: unknown };
  };
  "social.syncGbpHours": {
    input: { profileId: string; locationId?: string };
    output: { profileId: string; jobId: string; queued: true; [key: string]: unknown };
  };
  "social.syncGbpReviews": {
    input: { profileId: string };
    output: { profileId: string; jobId: string; queued: true; [key: string]: unknown };
  };
  "social.variantList": {
    input: { packageId?: string };
    output: { id: string; packageId: string; profileId: string; caption: string; hashtags: string[]; assetIds: string[]; aspectRatio: "1:1" | "4:5" | "9:16" | "16:9"; generated: boolean; status: "draft" | "pending_review" | "approved" | "rejected"; createdAt: string; [key: string]: unknown }[];
  };
  "subscriptions.attachProviderSchedule": {
    input: { subscriptionId: string };
    output: { id: string; providerRef: string; [key: string]: unknown };
  };
  "subscriptions.cancel": {
    input: { id: string; immediately?: boolean; reason?: string };
    output: { id: string; contactId: string; planId: string; productVariantId: string; currency: string; billingMode: "provider" | "platform" | "manual"; status: "trialing" | "active" | "past_due" | "paused" | "cancelled" | "expired"; currentPeriodStart: string; currentPeriodEnd: string; trialEndsAt: string | null; paymentMethodId: string | null; pendingPlanId: string | null; provider: string | null; providerRef: string | null; cancelAtPeriodEnd: boolean; pausedAt: string | null; cancelledAt: string | null; endedAt: string | null; graceEndsAt: string | null; dunningNextAt: string | null; updatedAt: string; [key: string]: unknown };
  };
  "subscriptions.cancelAgreement": {
    input: { id: string; immediately?: boolean; reason?: string };
    output: { id: string; status: string; cancelAtPeriodEnd: boolean; [key: string]: unknown };
  };
  "subscriptions.cancelMine": {
    input: { id: string };
    output: { cancelled: boolean; endsAt: string; provider: string | null; providerRef: string | null; [key: string]: unknown };
  };
  "subscriptions.cancelMyAgreement": {
    input: { id: string };
    output: { cancelled: boolean; endsAt: string; [key: string]: unknown };
  };
  "subscriptions.changeMine": {
    input: { id: string; planId: string };
    output: { subscriptionId: string; invoiceId: string | null; proratedMinor: number; deferred: boolean; billingMode: "provider" | "platform" | "manual"; provider: string | null; providerRef: string | null; previousProvider: string | null; previousProviderRef: string | null; interval: "day" | "week" | "month" | "year"; intervalCount: number; amountMinor: number; currency: string; description: string; proration: "create_prorations" | "none"; methodRef: string | null; customerRef: string | null };
  };
  "subscriptions.changePlan": {
    input: { id: string; planId: string };
    output: { subscriptionId: string; invoiceId: string | null; proratedMinor: number; deferred: boolean; billingMode: "provider" | "platform" | "manual"; provider: string | null; providerRef: string | null; previousProvider: string | null; previousProviderRef: string | null; interval: "day" | "week" | "month" | "year"; intervalCount: number; amountMinor: number; currency: string; description: string; proration: "create_prorations" | "none"; methodRef: string | null; customerRef: string | null };
  };
  "subscriptions.chargePlatformInvoice": {
    input: { subscriptionId: string; invoiceId?: string };
    output: { advanced: boolean; skipped: boolean; [key: string]: unknown };
  };
  "subscriptions.enroll": {
    input: { contactId: string; planId: string; productVariantId?: string; currency?: string; paymentMethodId?: string };
    output: { subscriptionId: string; invoiceId: string | null; status: string };
  };
  "subscriptions.get": {
    input: { id: string };
    output: { subscription: { id: string; contactId: string; planId: string; productVariantId: string; currency: string; billingMode: "provider" | "platform" | "manual"; status: "trialing" | "active" | "past_due" | "paused" | "cancelled" | "expired"; currentPeriodStart: string; currentPeriodEnd: string; trialEndsAt: string | null; paymentMethodId: string | null; pendingPlanId: string | null; provider: string | null; providerRef: string | null; cancelAtPeriodEnd: boolean; pausedAt: string | null; cancelledAt: string | null; endedAt: string | null; graceEndsAt: string | null; dunningNextAt: string | null; updatedAt: string; [key: string]: unknown }; plan: { id: string; productId: string; name: string; interval: "day" | "week" | "month" | "year"; intervalCount: number; trialDays: number; trialRequiresCard: boolean; setupFeeMinor: number; billingMode: "provider" | "platform" | "manual"; cancelBehaviour: "period_end" | "immediate"; proration: "create_prorations" | "none"; status: "draft" | "active" | "archived"; updatedAt: string; [key: string]: unknown } | null; history: { kind: "created" | "trialing" | "activated" | "renewed" | "payment_failed" | "dunning" | "paused" | "resumed" | "plan_changed" | "cancelled" | "expired"; invoiceId: string | null; detail: string | null; at: string; [key: string]: unknown }[]; [key: string]: unknown };
  };
  "subscriptions.list": {
    input: { contactId?: string; status?: "trialing" | "active" | "past_due" | "paused" | "cancelled" | "expired"; limit?: number };
    output: { id: string; contactId: string; planId: string; productVariantId: string; currency: string; billingMode: "provider" | "platform" | "manual"; status: "trialing" | "active" | "past_due" | "paused" | "cancelled" | "expired"; currentPeriodStart: string; currentPeriodEnd: string; trialEndsAt: string | null; paymentMethodId: string | null; pendingPlanId: string | null; provider: string | null; providerRef: string | null; cancelAtPeriodEnd: boolean; pausedAt: string | null; cancelledAt: string | null; endedAt: string | null; graceEndsAt: string | null; dunningNextAt: string | null; updatedAt: string; [key: string]: unknown }[];
  };
  "subscriptions.listOffered": {
    input: Record<string, never>;
    output: { id: string; productId: string; name: string; interval: "day" | "week" | "month" | "year"; intervalCount: number; trialDays: number; trialRequiresCard: boolean; setupFeeMinor: number; billingMode: "provider" | "platform" | "manual"; cancelBehaviour: "period_end" | "immediate"; proration: "create_prorations" | "none"; status: "draft" | "active" | "archived"; updatedAt: string; [key: string]: unknown }[];
  };
  "subscriptions.listPlans": {
    input: { status?: "draft" | "active" | "archived" };
    output: { id: string; productId: string; name: string; interval: "day" | "week" | "month" | "year"; intervalCount: number; trialDays: number; trialRequiresCard: boolean; setupFeeMinor: number; billingMode: "provider" | "platform" | "manual"; cancelBehaviour: "period_end" | "immediate"; proration: "create_prorations" | "none"; status: "draft" | "active" | "archived"; updatedAt: string; dunning: { retries: number[]; graceDays: number; notifyChannels: ("email" | "sms" | "in_app")[]; finalAction: "pause" | "cancel" | "downgrade"; downgradeToPlanId: string | null; [key: string]: unknown } | null; [key: string]: unknown }[];
  };
  "subscriptions.pause": {
    input: { id: string };
    output: { id: string; contactId: string; planId: string; productVariantId: string; currency: string; billingMode: "provider" | "platform" | "manual"; status: "trialing" | "active" | "past_due" | "paused" | "cancelled" | "expired"; currentPeriodStart: string; currentPeriodEnd: string; trialEndsAt: string | null; paymentMethodId: string | null; pendingPlanId: string | null; provider: string | null; providerRef: string | null; cancelAtPeriodEnd: boolean; pausedAt: string | null; cancelledAt: string | null; endedAt: string | null; graceEndsAt: string | null; dunningNextAt: string | null; updatedAt: string; [key: string]: unknown };
  };
  "subscriptions.resume": {
    input: { id: string };
    output: { id: string; contactId: string; planId: string; productVariantId: string; currency: string; billingMode: "provider" | "platform" | "manual"; status: "trialing" | "active" | "past_due" | "paused" | "cancelled" | "expired"; currentPeriodStart: string; currentPeriodEnd: string; trialEndsAt: string | null; paymentMethodId: string | null; pendingPlanId: string | null; provider: string | null; providerRef: string | null; cancelAtPeriodEnd: boolean; pausedAt: string | null; cancelledAt: string | null; endedAt: string | null; graceEndsAt: string | null; dunningNextAt: string | null; updatedAt: string; [key: string]: unknown };
  };
  "subscriptions.savePlan": {
    input: { id?: string; productId: string; name: string; interval?: "day" | "week" | "month" | "year"; intervalCount?: number; trialDays?: number; trialRequiresCard?: boolean; setupFeeMinor?: number; billingMode?: "provider" | "platform" | "manual"; cancelBehaviour?: "period_end" | "immediate"; proration?: "create_prorations" | "none"; status?: "draft" | "active" | "archived"; dunning?: { retries?: number[]; graceDays?: number; notifyChannels?: ("email" | "sms" | "in_app")[]; finalAction?: "pause" | "cancel" | "downgrade"; downgradeToPlanId?: string | null } };
    output: { id: string; productId: string; name: string; interval: "day" | "week" | "month" | "year"; intervalCount: number; trialDays: number; trialRequiresCard: boolean; setupFeeMinor: number; billingMode: "provider" | "platform" | "manual"; cancelBehaviour: "period_end" | "immediate"; proration: "create_prorations" | "none"; status: "draft" | "active" | "archived"; updatedAt: string; dunning: { retries: number[]; graceDays: number; notifyChannels: ("email" | "sms" | "in_app")[]; finalAction: "pause" | "cancel" | "downgrade"; downgradeToPlanId: string | null; [key: string]: unknown } | null; [key: string]: unknown };
  };
  "subscriptions.subscribe": {
    input: { contactId: string; planId: string; productVariantId?: string; currency?: string; paymentMethodId?: string };
    output: { subscription: { id: string; contactId: string; planId: string; productVariantId: string; currency: string; billingMode: "provider" | "platform" | "manual"; status: "trialing" | "active" | "past_due" | "paused" | "cancelled" | "expired"; currentPeriodStart: string; currentPeriodEnd: string; trialEndsAt: string | null; paymentMethodId: string | null; pendingPlanId: string | null; provider: string | null; providerRef: string | null; cancelAtPeriodEnd: boolean; pausedAt: string | null; cancelledAt: string | null; endedAt: string | null; graceEndsAt: string | null; dunningNextAt: string | null; updatedAt: string; [key: string]: unknown }; invoiceId: string | null; [key: string]: unknown };
  };
  "tasks.create": {
    input: { subjectType?: ("contact" | "deal" | "quote" | "invoice" | "booking" | "project" | "contract" | "order") | null; subjectId?: string | null } & { title: string; details?: string | null; dueAt?: string | null; remindAt?: string | null; assigneeUserId?: string | null; priority?: "low" | "normal" | "high" | "urgent"; cadence?: ("daily" | "weekly" | "monthly" | "quarterly" | "yearly") | null; intervalCount?: number };
    output: { id: string; subjectType: ("contact" | "deal" | "quote" | "invoice" | "booking" | "project" | "contract" | "order") | null; subjectId: string | null; contactId: string | null; title: string; details: string | null; dueAt: string | null; remindAt: string | null; remindedAt: string | null; assigneeUserId: string | null; priority: "low" | "normal" | "high" | "urgent"; status: "open" | "doing" | "blocked" | "done" | "cancelled"; position: number; cadence: ("daily" | "weekly" | "monthly" | "quarterly" | "yearly") | null; intervalCount: number; recurredFromId: string | null; completedAt: string | null; completedBy: string | null; [key: string]: unknown };
  };
  "tasks.list": {
    input: { status?: "open" | "doing" | "blocked" | "done" | "cancelled"; openOnly?: boolean; assigneeUserId?: string; unassigned?: boolean; subjectType?: "contact" | "deal" | "quote" | "invoice" | "booking" | "project" | "contract" | "order"; subjectId?: string; contactId?: string; overdue?: boolean; dueBefore?: string; limit?: number };
    output: { id: string; subjectType: ("contact" | "deal" | "quote" | "invoice" | "booking" | "project" | "contract" | "order") | null; subjectId: string | null; contactId: string | null; title: string; details: string | null; dueAt: string | null; remindAt: string | null; remindedAt: string | null; assigneeUserId: string | null; priority: "low" | "normal" | "high" | "urgent"; status: "open" | "doing" | "blocked" | "done" | "cancelled"; position: number; cadence: ("daily" | "weekly" | "monthly" | "quarterly" | "yearly") | null; intervalCount: number; recurredFromId: string | null; completedAt: string | null; completedBy: string | null; contactName: string | null; assigneeEmail: string | null; href: string | null; [key: string]: unknown }[];
  };
  "tasks.remove": {
    input: { id: string };
    output: { id: string; [key: string]: unknown };
  };
  "tasks.setStatus": {
    input: { id: string; status: "open" | "doing" | "blocked" | "done" | "cancelled" };
    output: { task: { id: string; subjectType: ("contact" | "deal" | "quote" | "invoice" | "booking" | "project" | "contract" | "order") | null; subjectId: string | null; contactId: string | null; title: string; details: string | null; dueAt: string | null; remindAt: string | null; remindedAt: string | null; assigneeUserId: string | null; priority: "low" | "normal" | "high" | "urgent"; status: "open" | "doing" | "blocked" | "done" | "cancelled"; position: number; cadence: ("daily" | "weekly" | "monthly" | "quarterly" | "yearly") | null; intervalCount: number; recurredFromId: string | null; completedAt: string | null; completedBy: string | null; [key: string]: unknown }; next: { id: string; subjectType: ("contact" | "deal" | "quote" | "invoice" | "booking" | "project" | "contract" | "order") | null; subjectId: string | null; contactId: string | null; title: string; details: string | null; dueAt: string | null; remindAt: string | null; remindedAt: string | null; assigneeUserId: string | null; priority: "low" | "normal" | "high" | "urgent"; status: "open" | "doing" | "blocked" | "done" | "cancelled"; position: number; cadence: ("daily" | "weekly" | "monthly" | "quarterly" | "yearly") | null; intervalCount: number; recurredFromId: string | null; completedAt: string | null; completedBy: string | null; [key: string]: unknown } | null; [key: string]: unknown };
  };
  "tasks.update": {
    input: { id: string; title?: string; details?: string | null; dueAt?: string | null; remindAt?: string | null; assigneeUserId?: string | null; priority?: "low" | "normal" | "high" | "urgent"; position?: number; cadence?: ("daily" | "weekly" | "monthly" | "quarterly" | "yearly") | null; intervalCount?: number };
    output: { id: string; subjectType: ("contact" | "deal" | "quote" | "invoice" | "booking" | "project" | "contract" | "order") | null; subjectId: string | null; contactId: string | null; title: string; details: string | null; dueAt: string | null; remindAt: string | null; remindedAt: string | null; assigneeUserId: string | null; priority: "low" | "normal" | "high" | "urgent"; status: "open" | "doing" | "blocked" | "done" | "cancelled"; position: number; cadence: ("daily" | "weekly" | "monthly" | "quarterly" | "yearly") | null; intervalCount: number; recurredFromId: string | null; completedAt: string | null; completedBy: string | null; [key: string]: unknown };
  };
  "templates.get": {
    input: { id: string };
    output: { template: { id: string; kind: "transactional" | "campaign" | "newsletter" | "automation" | "sms"; name: string; slug: string | null; subject: string; blocks: unknown; variables: unknown; status: "draft" | "active" | "archived"; customised: boolean; updatedAt: string; [key: string]: unknown }; locales: string[]; [key: string]: unknown };
  };
  "templates.list": {
    input: { kind?: "transactional" | "campaign" | "newsletter" | "automation" | "sms"; status?: "draft" | "active" | "archived" };
    output: { id: string; kind: "transactional" | "campaign" | "newsletter" | "automation" | "sms"; name: string; slug: string | null; subject: string; blocks: unknown; variables: unknown; status: "draft" | "active" | "archived"; customised: boolean; updatedAt: string; [key: string]: unknown }[];
  };
  "templates.render": {
    input: { id?: string; slug?: string; locale?: string | null; variables?: { [key: string]: string } };
    output: { subject: string; html: string; text: string; locale: string | null; [key: string]: unknown };
  };
  "templates.reset": {
    input: { id: string };
    output: { id: string; kind: "transactional" | "campaign" | "newsletter" | "automation" | "sms"; name: string; slug: string | null; subject: string; blocks: unknown; variables: unknown; status: "draft" | "active" | "archived"; customised: boolean; updatedAt: string; [key: string]: unknown };
  };
  "templates.save": {
    input: { id?: string; kind: "transactional" | "campaign" | "newsletter" | "automation" | "sms"; name: string; slug?: string | null; subject?: string; blocks?: unknown[]; variables?: ("contact.first_name" | "contact.email" | "business.name" | "invoice.total" | "booking.starts_at_local")[]; status?: "draft" | "active" | "archived" };
    output: { id: string; kind: "transactional" | "campaign" | "newsletter" | "automation" | "sms"; name: string; slug: string | null; subject: string; blocks: unknown; variables: unknown; status: "draft" | "active" | "archived"; customised: boolean; updatedAt: string; [key: string]: unknown };
  };
  "templates.slots": {
    input: Record<string, never>;
    output: { slot: string; [key: string]: unknown }[];
  };
  "time.invoice": {
    input: { entryIds: string[]; currency?: string; projectId?: string | null };
    output: { invoiceId: string; lines: number; totalMinor: number; [key: string]: unknown };
  };
  "time.list": {
    input: { projectId?: string; contactId?: string; unbilledOnly?: boolean; limit?: number };
    output: { id: string; userId: string | null; contactId: string | null; projectId: string | null; bookingId: string | null; description: string; startedAt: string; endedAt: string | null; minutes: number; billable: boolean; rateMinor: number; currency: string | null; invoiceId: string | null; invoicedAt: string | null; amountMinor: number; [key: string]: unknown }[];
  };
  "time.log": {
    input: { description: string; minutes: number; startedAt?: string; projectId?: string | null; bookingId?: string | null; billable?: boolean; rateMinor?: number };
    output: { id: string; userId: string | null; contactId: string | null; projectId: string | null; bookingId: string | null; description: string; startedAt: string; endedAt: string | null; minutes: number; billable: boolean; rateMinor: number; currency: string | null; invoiceId: string | null; invoicedAt: string | null; [key: string]: unknown };
  };
  "time.rates": {
    input: Record<string, never>;
    output: { id: string; scope: "business" | "user" | "project"; scopeId: string | null; rateMinor: number; currency: string; [key: string]: unknown }[];
  };
  "time.remove": {
    input: { id: string };
    output: { id: string; [key: string]: unknown };
  };
  "time.setRate": {
    input: { scope: "business" | "user" | "project"; scopeId?: string | null; rateMinor: number; currency?: string };
    output: { id: string; scope: "business" | "user" | "project"; scopeId: string | null; rateMinor: number; currency: string; [key: string]: unknown };
  };
  "time.start": {
    input: { description: string; projectId?: string | null; bookingId?: string | null; billable?: boolean };
    output: { id: string; userId: string | null; contactId: string | null; projectId: string | null; bookingId: string | null; description: string; startedAt: string; endedAt: string | null; minutes: number; billable: boolean; rateMinor: number; currency: string | null; invoiceId: string | null; invoicedAt: string | null; [key: string]: unknown };
  };
  "time.stop": {
    input: { roundToMinutes?: number };
    output: { id: string; userId: string | null; contactId: string | null; projectId: string | null; bookingId: string | null; description: string; startedAt: string; endedAt: string | null; minutes: number; billable: boolean; rateMinor: number; currency: string | null; invoiceId: string | null; invoicedAt: string | null; [key: string]: unknown } | null;
  };
  "time.update": {
    input: { id: string; description?: string; minutes?: number; billable?: boolean; rateMinor?: number };
    output: { id: string; userId: string | null; contactId: string | null; projectId: string | null; bookingId: string | null; description: string; startedAt: string; endedAt: string | null; minutes: number; billable: boolean; rateMinor: number; currency: string | null; invoiceId: string | null; invoicedAt: string | null; [key: string]: unknown };
  };
  "views.default": {
    input: { entity: string };
    output: { id: string; entity: string; name: string; filters: { [key: string]: string }; columns: string[]; sortKey: string | null; sortDir: ("asc" | "desc") | null; ownerUserId: string | null; shared: boolean; isDefault: boolean; [key: string]: unknown } | null;
  };
  "views.entities": {
    input: Record<string, never>;
    output: { key: string; label: string; path: string; filters: { key: string; label: string; [key: string]: unknown }[]; columns: { key: string; label: string; fixed: boolean; [key: string]: unknown }[]; [key: string]: unknown }[];
  };
  "views.list": {
    input: { entity: string };
    output: { id: string; entity: string; name: string; filters: { [key: string]: string }; columns: string[]; sortKey: string | null; sortDir: ("asc" | "desc") | null; ownerUserId: string | null; shared: boolean; isDefault: boolean; mine: boolean; [key: string]: unknown }[];
  };
  "views.remove": {
    input: { id: string };
    output: { id: string; [key: string]: unknown };
  };
  "views.save": {
    input: { id?: string; entity: string; name: string; filters?: { [key: string]: string }; columns?: string[]; sortKey?: string | null; sortDir?: ("asc" | "desc") | null; shared?: boolean; isDefault?: boolean };
    output: { id: string; entity: string; name: string; filters: { [key: string]: string }; columns: string[]; sortKey: string | null; sortDir: ("asc" | "desc") | null; ownerUserId: string | null; shared: boolean; isDefault: boolean; [key: string]: unknown };
  };
  "views.setDefault": {
    input: { id?: string | null; entity: string };
    output: { id: string | null; [key: string]: unknown };
  };
  "voiceVideo.list": {
    input: Record<string, never>;
    output: { id: string; contactId: string; kind: string; provider: string; title: string; status: string; externalRef: string | null; conversationId: string | null; lastError: string | null; [key: string]: unknown }[];
  };
  "voiceVideo.record": {
    input: { contactId: string; kind: "voice" | "video"; provider: string; title: string; artifactId?: string };
    output: { id: string; contactId: string; kind: string; provider: string; title: string; status: string; externalRef: string | null; conversationId: string | null; lastError: string | null; [key: string]: unknown };
  };
  "waitlist.claim": {
    input: { token: string };
    output: { bookingId: string; startsAt: string; endsAt: string };
  };
  "waitlist.expireOffers": {
    input: Record<string, never>;
    output: { expired: number; reoffered: number };
  };
  "waitlist.join": {
    input: { contact: { email: string; name?: string; phone?: string }; calendarId?: string | null; serviceOfferingId?: string | null; windowStart: string; windowEnd: string; seatCount?: number; notes?: string | null };
    output: { id: string; contactId: string; serviceOfferingId: string | null; calendarId: string | null; windowStart: string; windowEnd: string; seatCount: number; status: "waiting" | "offered" | "booked" | "expired" | "withdrawn"; position: number; offeredAt: string | null; offerExpiresAt: string | null; offerStartsAt: string | null; offerEndsAt: string | null; bookingId: string | null; notes: string | null; [key: string]: unknown };
  };
  "waitlist.list": {
    input: { calendarId?: string; status?: "waiting" | "offered" | "booked" | "expired" | "withdrawn"; limit?: number };
    output: { id: string; contactId: string; serviceOfferingId: string | null; calendarId: string | null; windowStart: string; windowEnd: string; seatCount: number; status: "waiting" | "offered" | "booked" | "expired" | "withdrawn"; position: number; offeredAt: string | null; offerExpiresAt: string | null; offerStartsAt: string | null; offerEndsAt: string | null; bookingId: string | null; notes: string | null; contactName: string | null; contactEmail: string | null; [key: string]: unknown }[];
  };
  "waitlist.offer": {
    input: { calendarId: string; startsAt: string; endsAt: string; entryId?: string; offerHours?: number };
    output: { offered: { id: string; contactId: string; serviceOfferingId: string | null; calendarId: string | null; windowStart: string; windowEnd: string; seatCount: number; status: "waiting" | "offered" | "booked" | "expired" | "withdrawn"; position: number; offeredAt: string | null; offerExpiresAt: string | null; offerStartsAt: string | null; offerEndsAt: string | null; bookingId: string | null; notes: string | null; [key: string]: unknown } | null; reason: string | null };
  };
  "waitlist.setPosition": {
    input: { id: string; position: number };
    output: { id: string; contactId: string; serviceOfferingId: string | null; calendarId: string | null; windowStart: string; windowEnd: string; seatCount: number; status: "waiting" | "offered" | "booked" | "expired" | "withdrawn"; position: number; offeredAt: string | null; offerExpiresAt: string | null; offerStartsAt: string | null; offerEndsAt: string | null; bookingId: string | null; notes: string | null; [key: string]: unknown };
  };
  "waitlist.withdraw": {
    input: { id: string };
    output: { id: string; contactId: string; serviceOfferingId: string | null; calendarId: string | null; windowStart: string; windowEnd: string; seatCount: number; status: "waiting" | "offered" | "booked" | "expired" | "withdrawn"; position: number; offeredAt: string | null; offerExpiresAt: string | null; offerStartsAt: string | null; offerEndsAt: string | null; bookingId: string | null; notes: string | null; [key: string]: unknown };
  };
  "webhooks.create": {
    input: { name: string; url: string; events: string[] };
    output: { id: string; name: string; url: string; events: string[]; status: "active" | "paused"; pausedReason: string | null; consecutiveFailures: number; lastDeliveryAt: string | null; createdAt: string; secret: string; createdBy: string | null; updatedAt: string; [key: string]: unknown };
  };
  "webhooks.deliveries": {
    input: { subscriptionId?: string; limit?: number };
    output: { id: string; subscriptionId: string; eventName: string; status: "pending" | "sending" | "succeeded" | "failed"; attempts: number; responseStatus: number | null; error: string | null; nextAttemptAt: string; createdAt: string; completedAt: string | null; [key: string]: unknown }[];
  };
  "webhooks.inspectDelivery": {
    input: { id: string };
    output: { id: string; subscriptionId: string; eventName: string; status: "pending" | "sending" | "succeeded" | "failed"; attempts: number; responseStatus: number | null; error: string | null; nextAttemptAt: string; createdAt: string; completedAt: string | null; payload: unknown; responseBody: string | null; [key: string]: unknown };
  };
  "webhooks.list": {
    input: Record<string, never>;
    output: { id: string; name: string; url: string; events: string[]; status: "active" | "paused"; pausedReason: string | null; consecutiveFailures: number; lastDeliveryAt: string | null; createdAt: string; [key: string]: unknown }[];
  };
  "webhooks.remove": {
    input: { id: string };
    output: { id: string; name: string };
  };
  "webhooks.replay": {
    input: { id: string };
    output: { deliveryId: string; jobId: string };
  };
  "webhooks.rotateEndpoint": {
    input: { id: string; url: string };
    output: { id: string; name: string; url: string; events: string[]; status: "active" | "paused"; pausedReason: string | null; consecutiveFailures: number; lastDeliveryAt: string | null; createdAt: string; secret: string; createdBy: string | null; updatedAt: string; [key: string]: unknown };
  };
  "webhooks.rotateSecret": {
    input: { id: string };
    output: { id: string; name: string; secret: string };
  };
  "webhooks.secret": {
    input: { id: string };
    output: { secret: string };
  };
  "webhooks.test": {
    input: { id: string };
    output: { deliveryId: string; jobId: string };
  };
  "webhooks.update": {
    input: { id: string; name?: string; url?: string; events?: string[]; status?: "active" | "paused" };
    output: { id: string; name: string; url: string; events: string[]; status: "active" | "paused"; pausedReason: string | null; consecutiveFailures: number; lastDeliveryAt: string | null; createdAt: string; secret: string; createdBy: string | null; updatedAt: string; [key: string]: unknown };
  };
}

export type ServiceInput<K extends ServiceName> = ServiceCatalog[K]["input"];
export type ServiceOutput<K extends ServiceName> = ServiceCatalog[K]["output"];

export const PAGEABLE_SERVICES = [
  "contacts.list",
  "contacts.listDuplicateCandidates",
  "contacts.listOrganizations",
  "media.list",
] as const;

export type PageableService = (typeof PAGEABLE_SERVICES)[number];

export interface FreeholderApi {
  ads: {
    addSize: (input: ServiceCatalog["ads.addSize"]["input"]) => Promise<ServiceCatalog["ads.addSize"]["output"]>;
    adsTxt: (input: ServiceCatalog["ads.adsTxt"]["input"]) => Promise<ServiceCatalog["ads.adsTxt"]["output"]>;
    advertisers: (input?: ServiceCatalog["ads.advertisers"]["input"]) => Promise<ServiceCatalog["ads.advertisers"]["output"]>;
    campaignReport: (input: ServiceCatalog["ads.campaignReport"]["input"]) => Promise<ServiceCatalog["ads.campaignReport"]["output"]>;
    campaigns: (input?: ServiceCatalog["ads.campaigns"]["input"]) => Promise<ServiceCatalog["ads.campaigns"]["output"]>;
    creatives: (input: ServiceCatalog["ads.creatives"]["input"]) => Promise<ServiceCatalog["ads.creatives"]["output"]>;
    decideCampaign: (input: ServiceCatalog["ads.decideCampaign"]["input"]) => Promise<ServiceCatalog["ads.decideCampaign"]["output"]>;
    deleteTxtEntry: (input: ServiceCatalog["ads.deleteTxtEntry"]["input"]) => Promise<ServiceCatalog["ads.deleteTxtEntry"]["output"]>;
    ensureSizes: (input?: ServiceCatalog["ads.ensureSizes"]["input"]) => Promise<ServiceCatalog["ads.ensureSizes"]["output"]>;
    invoiceCampaign: (input: ServiceCatalog["ads.invoiceCampaign"]["input"]) => Promise<ServiceCatalog["ads.invoiceCampaign"]["output"]>;
    lineItems: (input: ServiceCatalog["ads.lineItems"]["input"]) => Promise<ServiceCatalog["ads.lineItems"]["output"]>;
    reconcileCampaign: (input: ServiceCatalog["ads.reconcileCampaign"]["input"]) => Promise<ServiceCatalog["ads.reconcileCampaign"]["output"]>;
    recordBeacon: (input: ServiceCatalog["ads.recordBeacon"]["input"]) => Promise<ServiceCatalog["ads.recordBeacon"]["output"]>;
    recordClick: (input: ServiceCatalog["ads.recordClick"]["input"]) => Promise<ServiceCatalog["ads.recordClick"]["output"]>;
    reviewCreative: (input: ServiceCatalog["ads.reviewCreative"]["input"]) => Promise<ServiceCatalog["ads.reviewCreative"]["output"]>;
    saveAdvertiser: (input?: ServiceCatalog["ads.saveAdvertiser"]["input"]) => Promise<ServiceCatalog["ads.saveAdvertiser"]["output"]>;
    saveCampaign: (input: ServiceCatalog["ads.saveCampaign"]["input"]) => Promise<ServiceCatalog["ads.saveCampaign"]["output"]>;
    saveCreative: (input: ServiceCatalog["ads.saveCreative"]["input"]) => Promise<ServiceCatalog["ads.saveCreative"]["output"]>;
    saveLineItem: (input: ServiceCatalog["ads.saveLineItem"]["input"]) => Promise<ServiceCatalog["ads.saveLineItem"]["output"]>;
    saveSlot: (input: ServiceCatalog["ads.saveSlot"]["input"]) => Promise<ServiceCatalog["ads.saveSlot"]["output"]>;
    saveTxtEntry: (input: ServiceCatalog["ads.saveTxtEntry"]["input"]) => Promise<ServiceCatalog["ads.saveTxtEntry"]["output"]>;
    serve: (input: ServiceCatalog["ads.serve"]["input"]) => Promise<ServiceCatalog["ads.serve"]["output"]>;
    setCampaignStatus: (input: ServiceCatalog["ads.setCampaignStatus"]["input"]) => Promise<ServiceCatalog["ads.setCampaignStatus"]["output"]>;
    sizes: (input?: ServiceCatalog["ads.sizes"]["input"]) => Promise<ServiceCatalog["ads.sizes"]["output"]>;
    slotByCode: (input: ServiceCatalog["ads.slotByCode"]["input"]) => Promise<ServiceCatalog["ads.slotByCode"]["output"]>;
    slots: (input?: ServiceCatalog["ads.slots"]["input"]) => Promise<ServiceCatalog["ads.slots"]["output"]>;
    txtEntries: (input?: ServiceCatalog["ads.txtEntries"]["input"]) => Promise<ServiceCatalog["ads.txtEntries"]["output"]>;
  };
  agents: {
    approveWrite: (input: ServiceCatalog["agents.approveWrite"]["input"]) => Promise<ServiceCatalog["agents.approveWrite"]["output"]>;
    assignTask: (input: ServiceCatalog["agents.assignTask"]["input"]) => Promise<ServiceCatalog["agents.assignTask"]["output"]>;
    board: (input?: ServiceCatalog["agents.board"]["input"]) => Promise<ServiceCatalog["agents.board"]["output"]>;
    cancelTask: (input: ServiceCatalog["agents.cancelTask"]["input"]) => Promise<ServiceCatalog["agents.cancelTask"]["output"]>;
    claimTask: (input?: ServiceCatalog["agents.claimTask"]["input"]) => Promise<ServiceCatalog["agents.claimTask"]["output"]>;
    completeTask: (input: ServiceCatalog["agents.completeTask"]["input"]) => Promise<ServiceCatalog["agents.completeTask"]["output"]>;
    connect: (input: ServiceCatalog["agents.connect"]["input"]) => Promise<ServiceCatalog["agents.connect"]["output"]>;
    connections: (input?: ServiceCatalog["agents.connections"]["input"]) => Promise<ServiceCatalog["agents.connections"]["output"]>;
    createPlaybook: (input: ServiceCatalog["agents.createPlaybook"]["input"]) => Promise<ServiceCatalog["agents.createPlaybook"]["output"]>;
    createTask: (input: ServiceCatalog["agents.createTask"]["input"]) => Promise<ServiceCatalog["agents.createTask"]["output"]>;
    deletePlaybook: (input: ServiceCatalog["agents.deletePlaybook"]["input"]) => Promise<ServiceCatalog["agents.deletePlaybook"]["output"]>;
    expireApprovals: (input?: ServiceCatalog["agents.expireApprovals"]["input"]) => Promise<ServiceCatalog["agents.expireApprovals"]["output"]>;
    exportPlaybook: (input: ServiceCatalog["agents.exportPlaybook"]["input"]) => Promise<ServiceCatalog["agents.exportPlaybook"]["output"]>;
    flagTask: (input: ServiceCatalog["agents.flagTask"]["input"]) => Promise<ServiceCatalog["agents.flagTask"]["output"]>;
    hire: (input: ServiceCatalog["agents.hire"]["input"]) => Promise<ServiceCatalog["agents.hire"]["output"]>;
    importPlaybook: (input: ServiceCatalog["agents.importPlaybook"]["input"]) => Promise<ServiceCatalog["agents.importPlaybook"]["output"]>;
    inspectRun: (input: ServiceCatalog["agents.inspectRun"]["input"]) => Promise<ServiceCatalog["agents.inspectRun"]["output"]>;
    list: (input?: ServiceCatalog["agents.list"]["input"]) => Promise<ServiceCatalog["agents.list"]["output"]>;
    listApprovals: (input?: ServiceCatalog["agents.listApprovals"]["input"]) => Promise<ServiceCatalog["agents.listApprovals"]["output"]>;
    pause: (input: ServiceCatalog["agents.pause"]["input"]) => Promise<ServiceCatalog["agents.pause"]["output"]>;
    pauseAll: (input?: ServiceCatalog["agents.pauseAll"]["input"]) => Promise<ServiceCatalog["agents.pauseAll"]["output"]>;
    playbook: (input: ServiceCatalog["agents.playbook"]["input"]) => Promise<ServiceCatalog["agents.playbook"]["output"]>;
    playbooks: (input?: ServiceCatalog["agents.playbooks"]["input"]) => Promise<ServiceCatalog["agents.playbooks"]["output"]>;
    proposeWrite: (input: ServiceCatalog["agents.proposeWrite"]["input"]) => Promise<ServiceCatalog["agents.proposeWrite"]["output"]>;
    rejectWrite: (input: ServiceCatalog["agents.rejectWrite"]["input"]) => Promise<ServiceCatalog["agents.rejectWrite"]["output"]>;
    releaseTask: (input: ServiceCatalog["agents.releaseTask"]["input"]) => Promise<ServiceCatalog["agents.releaseTask"]["output"]>;
    reopenTask: (input: ServiceCatalog["agents.reopenTask"]["input"]) => Promise<ServiceCatalog["agents.reopenTask"]["output"]>;
    reportStep: (input: ServiceCatalog["agents.reportStep"]["input"]) => Promise<ServiceCatalog["agents.reportStep"]["output"]>;
    retryTask: (input: ServiceCatalog["agents.retryTask"]["input"]) => Promise<ServiceCatalog["agents.retryTask"]["output"]>;
    runPlaybook: (input: ServiceCatalog["agents.runPlaybook"]["input"]) => Promise<ServiceCatalog["agents.runPlaybook"]["output"]>;
    setPlaybookSchedule: (input: ServiceCatalog["agents.setPlaybookSchedule"]["input"]) => Promise<ServiceCatalog["agents.setPlaybookSchedule"]["output"]>;
    spend: (input?: ServiceCatalog["agents.spend"]["input"]) => Promise<ServiceCatalog["agents.spend"]["output"]>;
    stopRun: (input: ServiceCatalog["agents.stopRun"]["input"]) => Promise<ServiceCatalog["agents.stopRun"]["output"]>;
    tailRun: (input: ServiceCatalog["agents.tailRun"]["input"]) => Promise<ServiceCatalog["agents.tailRun"]["output"]>;
    task: (input: ServiceCatalog["agents.task"]["input"]) => Promise<ServiceCatalog["agents.task"]["output"]>;
    tasks: (input?: ServiceCatalog["agents.tasks"]["input"]) => Promise<ServiceCatalog["agents.tasks"]["output"]>;
    update: (input: ServiceCatalog["agents.update"]["input"]) => Promise<ServiceCatalog["agents.update"]["output"]>;
    updatePlaybook: (input: ServiceCatalog["agents.updatePlaybook"]["input"]) => Promise<ServiceCatalog["agents.updatePlaybook"]["output"]>;
    updateTask: (input: ServiceCatalog["agents.updateTask"]["input"]) => Promise<ServiceCatalog["agents.updateTask"]["output"]>;
  };
  analytics: {
    campaignAttribution: (input?: ServiceCatalog["analytics.campaignAttribution"]["input"]) => Promise<ServiceCatalog["analytics.campaignAttribution"]["output"]>;
    campaignTotals: (input: ServiceCatalog["analytics.campaignTotals"]["input"]) => Promise<ServiceCatalog["analytics.campaignTotals"]["output"]>;
    classificationCandidates: (input?: ServiceCatalog["analytics.classificationCandidates"]["input"]) => Promise<ServiceCatalog["analytics.classificationCandidates"]["output"]>;
    contactActivity: (input: ServiceCatalog["analytics.contactActivity"]["input"]) => Promise<ServiceCatalog["analytics.contactActivity"]["output"]>;
    correctClassification: (input: ServiceCatalog["analytics.correctClassification"]["input"]) => Promise<ServiceCatalog["analytics.correctClassification"]["output"]>;
    daily: (input?: ServiceCatalog["analytics.daily"]["input"]) => Promise<ServiceCatalog["analytics.daily"]["output"]>;
    experimentReport: (input?: ServiceCatalog["analytics.experimentReport"]["input"]) => Promise<ServiceCatalog["analytics.experimentReport"]["output"]>;
    exportAnonymized: (input?: ServiceCatalog["analytics.exportAnonymized"]["input"]) => Promise<ServiceCatalog["analytics.exportAnonymized"]["output"]>;
    funnel: (input?: ServiceCatalog["analytics.funnel"]["input"]) => Promise<ServiceCatalog["analytics.funnel"]["output"]>;
    funnelDefinitions: (input?: ServiceCatalog["analytics.funnelDefinitions"]["input"]) => Promise<ServiceCatalog["analytics.funnelDefinitions"]["output"]>;
    identify: (input: ServiceCatalog["analytics.identify"]["input"]) => Promise<ServiceCatalog["analytics.identify"]["output"]>;
    overview: (input?: ServiceCatalog["analytics.overview"]["input"]) => Promise<ServiceCatalog["analytics.overview"]["output"]>;
    recordExperimentConversion: (input: ServiceCatalog["analytics.recordExperimentConversion"]["input"]) => Promise<ServiceCatalog["analytics.recordExperimentConversion"]["output"]>;
    recordExperimentImpressions: (input: ServiceCatalog["analytics.recordExperimentImpressions"]["input"]) => Promise<ServiceCatalog["analytics.recordExperimentImpressions"]["output"]>;
    recordWebVital: (input: ServiceCatalog["analytics.recordWebVital"]["input"]) => Promise<ServiceCatalog["analytics.recordWebVital"]["output"]>;
    topPages: (input?: ServiceCatalog["analytics.topPages"]["input"]) => Promise<ServiceCatalog["analytics.topPages"]["output"]>;
    topReferrers: (input?: ServiceCatalog["analytics.topReferrers"]["input"]) => Promise<ServiceCatalog["analytics.topReferrers"]["output"]>;
    track: (input: ServiceCatalog["analytics.track"]["input"]) => Promise<ServiceCatalog["analytics.track"]["output"]>;
    webVitals: (input?: ServiceCatalog["analytics.webVitals"]["input"]) => Promise<ServiceCatalog["analytics.webVitals"]["output"]>;
  };
  apikeys: {
    create: (input: ServiceCatalog["apikeys.create"]["input"]) => Promise<ServiceCatalog["apikeys.create"]["output"]>;
    list: (input?: ServiceCatalog["apikeys.list"]["input"]) => Promise<ServiceCatalog["apikeys.list"]["output"]>;
    revoke: (input: ServiceCatalog["apikeys.revoke"]["input"]) => Promise<ServiceCatalog["apikeys.revoke"]["output"]>;
    scopes: (input?: ServiceCatalog["apikeys.scopes"]["input"]) => Promise<ServiceCatalog["apikeys.scopes"]["output"]>;
  };
  assistant: {
    answer: (input: ServiceCatalog["assistant.answer"]["input"]) => Promise<ServiceCatalog["assistant.answer"]["output"]>;
    deleteKnowledge: (input: ServiceCatalog["assistant.deleteKnowledge"]["input"]) => Promise<ServiceCatalog["assistant.deleteKnowledge"]["output"]>;
    dismissGap: (input: ServiceCatalog["assistant.dismissGap"]["input"]) => Promise<ServiceCatalog["assistant.dismissGap"]["output"]>;
    knowledgeGapList: (input?: ServiceCatalog["assistant.knowledgeGapList"]["input"]) => Promise<ServiceCatalog["assistant.knowledgeGapList"]["output"]>;
    knowledgeList: (input?: ServiceCatalog["assistant.knowledgeList"]["input"]) => Promise<ServiceCatalog["assistant.knowledgeList"]["output"]>;
    reindex: (input?: ServiceCatalog["assistant.reindex"]["input"]) => Promise<ServiceCatalog["assistant.reindex"]["output"]>;
    saveGapAsKnowledge: (input: ServiceCatalog["assistant.saveGapAsKnowledge"]["input"]) => Promise<ServiceCatalog["assistant.saveGapAsKnowledge"]["output"]>;
    saveKnowledge: (input: ServiceCatalog["assistant.saveKnowledge"]["input"]) => Promise<ServiceCatalog["assistant.saveKnowledge"]["output"]>;
    scopes: (input?: ServiceCatalog["assistant.scopes"]["input"]) => Promise<ServiceCatalog["assistant.scopes"]["output"]>;
    setScope: (input: ServiceCatalog["assistant.setScope"]["input"]) => Promise<ServiceCatalog["assistant.setScope"]["output"]>;
    settings: (input?: ServiceCatalog["assistant.settings"]["input"]) => Promise<ServiceCatalog["assistant.settings"]["output"]>;
    turns: (input?: ServiceCatalog["assistant.turns"]["input"]) => Promise<ServiceCatalog["assistant.turns"]["output"]>;
    updateSettings: (input: ServiceCatalog["assistant.updateSettings"]["input"]) => Promise<ServiceCatalog["assistant.updateSettings"]["output"]>;
  };
  audiences: {
    create: (input: ServiceCatalog["audiences.create"]["input"]) => Promise<ServiceCatalog["audiences.create"]["output"]>;
    link: (input: ServiceCatalog["audiences.link"]["input"]) => Promise<ServiceCatalog["audiences.link"]["output"]>;
    list: (input?: ServiceCatalog["audiences.list"]["input"]) => Promise<ServiceCatalog["audiences.list"]["output"]>;
    remove: (input: ServiceCatalog["audiences.remove"]["input"]) => Promise<ServiceCatalog["audiences.remove"]["output"]>;
    rotateLink: (input: ServiceCatalog["audiences.rotateLink"]["input"]) => Promise<ServiceCatalog["audiences.rotateLink"]["output"]>;
    setCalendars: (input: ServiceCatalog["audiences.setCalendars"]["input"]) => Promise<ServiceCatalog["audiences.setCalendars"]["output"]>;
    setHours: (input: ServiceCatalog["audiences.setHours"]["input"]) => Promise<ServiceCatalog["audiences.setHours"]["output"]>;
    setServices: (input: ServiceCatalog["audiences.setServices"]["input"]) => Promise<ServiceCatalog["audiences.setServices"]["output"]>;
  };
  auth: {
    beginTotpEnrollment: (input?: ServiceCatalog["auth.beginTotpEnrollment"]["input"]) => Promise<ServiceCatalog["auth.beginTotpEnrollment"]["output"]>;
    beginWebAuthnRegistration: (input?: ServiceCatalog["auth.beginWebAuthnRegistration"]["input"]) => Promise<ServiceCatalog["auth.beginWebAuthnRegistration"]["output"]>;
    beginWebAuthnStepUp: (input?: ServiceCatalog["auth.beginWebAuthnStepUp"]["input"]) => Promise<ServiceCatalog["auth.beginWebAuthnStepUp"]["output"]>;
    changePassword: (input: ServiceCatalog["auth.changePassword"]["input"]) => Promise<ServiceCatalog["auth.changePassword"]["output"]>;
    completeTwoFactorLogin: (input: ServiceCatalog["auth.completeTwoFactorLogin"]["input"]) => Promise<ServiceCatalog["auth.completeTwoFactorLogin"]["output"]>;
    completeWebAuthnLogin: (input: ServiceCatalog["auth.completeWebAuthnLogin"]["input"]) => Promise<ServiceCatalog["auth.completeWebAuthnLogin"]["output"]>;
    confirmTotpEnrollment: (input: ServiceCatalog["auth.confirmTotpEnrollment"]["input"]) => Promise<ServiceCatalog["auth.confirmTotpEnrollment"]["output"]>;
    consumeCustomerMagicLink: (input: ServiceCatalog["auth.consumeCustomerMagicLink"]["input"]) => Promise<ServiceCatalog["auth.consumeCustomerMagicLink"]["output"]>;
    finishWebAuthnRegistration: (input: ServiceCatalog["auth.finishWebAuthnRegistration"]["input"]) => Promise<ServiceCatalog["auth.finishWebAuthnRegistration"]["output"]>;
    finishWebAuthnStepUp: (input: ServiceCatalog["auth.finishWebAuthnStepUp"]["input"]) => Promise<ServiceCatalog["auth.finishWebAuthnStepUp"]["output"]>;
    listSessions: (input?: ServiceCatalog["auth.listSessions"]["input"]) => Promise<ServiceCatalog["auth.listSessions"]["output"]>;
    login: (input: ServiceCatalog["auth.login"]["input"]) => Promise<ServiceCatalog["auth.login"]["output"]>;
    loginChallengeDetails: (input: ServiceCatalog["auth.loginChallengeDetails"]["input"]) => Promise<ServiceCatalog["auth.loginChallengeDetails"]["output"]>;
    logout: (input: ServiceCatalog["auth.logout"]["input"]) => Promise<ServiceCatalog["auth.logout"]["output"]>;
    recentLoginSecurity: (input?: ServiceCatalog["auth.recentLoginSecurity"]["input"]) => Promise<ServiceCatalog["auth.recentLoginSecurity"]["output"]>;
    regenerateRecoveryCodes: (input?: ServiceCatalog["auth.regenerateRecoveryCodes"]["input"]) => Promise<ServiceCatalog["auth.regenerateRecoveryCodes"]["output"]>;
    registerOwner: (input: ServiceCatalog["auth.registerOwner"]["input"]) => Promise<ServiceCatalog["auth.registerOwner"]["output"]>;
    removeTotpFactor: (input?: ServiceCatalog["auth.removeTotpFactor"]["input"]) => Promise<ServiceCatalog["auth.removeTotpFactor"]["output"]>;
    removeWebAuthnFactor: (input: ServiceCatalog["auth.removeWebAuthnFactor"]["input"]) => Promise<ServiceCatalog["auth.removeWebAuthnFactor"]["output"]>;
    requestCustomerMagicLink: (input: ServiceCatalog["auth.requestCustomerMagicLink"]["input"]) => Promise<ServiceCatalog["auth.requestCustomerMagicLink"]["output"]>;
    requestPasswordReset: (input: ServiceCatalog["auth.requestPasswordReset"]["input"]) => Promise<ServiceCatalog["auth.requestPasswordReset"]["output"]>;
    resetPassword: (input: ServiceCatalog["auth.resetPassword"]["input"]) => Promise<ServiceCatalog["auth.resetPassword"]["output"]>;
    revokeOtherSessions: (input?: ServiceCatalog["auth.revokeOtherSessions"]["input"]) => Promise<ServiceCatalog["auth.revokeOtherSessions"]["output"]>;
    revokeSession: (input: ServiceCatalog["auth.revokeSession"]["input"]) => Promise<ServiceCatalog["auth.revokeSession"]["output"]>;
    twoFactorStatus: (input?: ServiceCatalog["auth.twoFactorStatus"]["input"]) => Promise<ServiceCatalog["auth.twoFactorStatus"]["output"]>;
    verifyStepUpCode: (input: ServiceCatalog["auth.verifyStepUpCode"]["input"]) => Promise<ServiceCatalog["auth.verifyStepUpCode"]["output"]>;
    whoami: (input: ServiceCatalog["auth.whoami"]["input"]) => Promise<ServiceCatalog["auth.whoami"]["output"]>;
  };
  automations: {
    checkGuardrails: (input: ServiceCatalog["automations.checkGuardrails"]["input"]) => Promise<ServiceCatalog["automations.checkGuardrails"]["output"]>;
    get: (input: ServiceCatalog["automations.get"]["input"]) => Promise<ServiceCatalog["automations.get"]["output"]>;
    inspectRun: (input: ServiceCatalog["automations.inspectRun"]["input"]) => Promise<ServiceCatalog["automations.inspectRun"]["output"]>;
    killRun: (input: ServiceCatalog["automations.killRun"]["input"]) => Promise<ServiceCatalog["automations.killRun"]["output"]>;
    list: (input?: ServiceCatalog["automations.list"]["input"]) => Promise<ServiceCatalog["automations.list"]["output"]>;
    publish: (input: ServiceCatalog["automations.publish"]["input"]) => Promise<ServiceCatalog["automations.publish"]["output"]>;
    restoreVersion: (input: ServiceCatalog["automations.restoreVersion"]["input"]) => Promise<ServiceCatalog["automations.restoreVersion"]["output"]>;
    run: (input: ServiceCatalog["automations.run"]["input"]) => Promise<ServiceCatalog["automations.run"]["output"]>;
    runs: (input?: ServiceCatalog["automations.runs"]["input"]) => Promise<ServiceCatalog["automations.runs"]["output"]>;
    save: (input: ServiceCatalog["automations.save"]["input"]) => Promise<ServiceCatalog["automations.save"]["output"]>;
    setStatus: (input: ServiceCatalog["automations.setStatus"]["input"]) => Promise<ServiceCatalog["automations.setStatus"]["output"]>;
    triggers: (input?: ServiceCatalog["automations.triggers"]["input"]) => Promise<ServiceCatalog["automations.triggers"]["output"]>;
    validate: (input: ServiceCatalog["automations.validate"]["input"]) => Promise<ServiceCatalog["automations.validate"]["output"]>;
    verbs: (input?: ServiceCatalog["automations.verbs"]["input"]) => Promise<ServiceCatalog["automations.verbs"]["output"]>;
    versionGraph: (input: ServiceCatalog["automations.versionGraph"]["input"]) => Promise<ServiceCatalog["automations.versionGraph"]["output"]>;
    versions: (input: ServiceCatalog["automations.versions"]["input"]) => Promise<ServiceCatalog["automations.versions"]["output"]>;
  };
  availability: {
    addException: (input: ServiceCatalog["availability.addException"]["input"]) => Promise<ServiceCatalog["availability.addException"]["output"]>;
    copyDay: (input: ServiceCatalog["availability.copyDay"]["input"]) => Promise<ServiceCatalog["availability.copyDay"]["output"]>;
    removeException: (input: ServiceCatalog["availability.removeException"]["input"]) => Promise<ServiceCatalog["availability.removeException"]["output"]>;
    rules: (input: ServiceCatalog["availability.rules"]["input"]) => Promise<ServiceCatalog["availability.rules"]["output"]>;
    setRules: (input: ServiceCatalog["availability.setRules"]["input"]) => Promise<ServiceCatalog["availability.setRules"]["output"]>;
    windows: (input: ServiceCatalog["availability.windows"]["input"]) => Promise<ServiceCatalog["availability.windows"]["output"]>;
  };
  bookings: {
    addParticipant: (input: ServiceCatalog["bookings.addParticipant"]["input"]) => Promise<ServiceCatalog["bookings.addParticipant"]["output"]>;
    addReminder: (input: ServiceCatalog["bookings.addReminder"]["input"]) => Promise<ServiceCatalog["bookings.addReminder"]["output"]>;
    attachIntake: (input: ServiceCatalog["bookings.attachIntake"]["input"]) => Promise<ServiceCatalog["bookings.attachIntake"]["output"]>;
    attachIntakeByToken: (input: ServiceCatalog["bookings.attachIntakeByToken"]["input"]) => Promise<ServiceCatalog["bookings.attachIntakeByToken"]["output"]>;
    byToken: (input: ServiceCatalog["bookings.byToken"]["input"]) => Promise<ServiceCatalog["bookings.byToken"]["output"]>;
    cancelByToken: (input: ServiceCatalog["bookings.cancelByToken"]["input"]) => Promise<ServiceCatalog["bookings.cancelByToken"]["output"]>;
    cancelReminder: (input: ServiceCatalog["bookings.cancelReminder"]["input"]) => Promise<ServiceCatalog["bookings.cancelReminder"]["output"]>;
    create: (input: ServiceCatalog["bookings.create"]["input"]) => Promise<ServiceCatalog["bookings.create"]["output"]>;
    get: (input: ServiceCatalog["bookings.get"]["input"]) => Promise<ServiceCatalog["bookings.get"]["output"]>;
    ics: (input: ServiceCatalog["bookings.ics"]["input"]) => Promise<ServiceCatalog["bookings.ics"]["output"]>;
    issueWaiver: (input: ServiceCatalog["bookings.issueWaiver"]["input"]) => Promise<ServiceCatalog["bookings.issueWaiver"]["output"]>;
    list: (input?: ServiceCatalog["bookings.list"]["input"]) => Promise<ServiceCatalog["bookings.list"]["output"]>;
    reminders: (input: ServiceCatalog["bookings.reminders"]["input"]) => Promise<ServiceCatalog["bookings.reminders"]["output"]>;
    removeParticipant: (input: ServiceCatalog["bookings.removeParticipant"]["input"]) => Promise<ServiceCatalog["bookings.removeParticipant"]["output"]>;
    requirements: (input: ServiceCatalog["bookings.requirements"]["input"]) => Promise<ServiceCatalog["bookings.requirements"]["output"]>;
    reschedule: (input: ServiceCatalog["bookings.reschedule"]["input"]) => Promise<ServiceCatalog["bookings.reschedule"]["output"]>;
    rescheduleByToken: (input: ServiceCatalog["bookings.rescheduleByToken"]["input"]) => Promise<ServiceCatalog["bookings.rescheduleByToken"]["output"]>;
    setParticipantStatus: (input: ServiceCatalog["bookings.setParticipantStatus"]["input"]) => Promise<ServiceCatalog["bookings.setParticipantStatus"]["output"]>;
    setStatus: (input: ServiceCatalog["bookings.setStatus"]["input"]) => Promise<ServiceCatalog["bookings.setStatus"]["output"]>;
  };
  briefing: {
    markRead: (input: ServiceCatalog["briefing.markRead"]["input"]) => Promise<ServiceCatalog["briefing.markRead"]["output"]>;
    recent: (input?: ServiceCatalog["briefing.recent"]["input"]) => Promise<ServiceCatalog["briefing.recent"]["output"]>;
    setSection: (input: ServiceCatalog["briefing.setSection"]["input"]) => Promise<ServiceCatalog["briefing.setSection"]["output"]>;
    today: (input?: ServiceCatalog["briefing.today"]["input"]) => Promise<ServiceCatalog["briefing.today"]["output"]>;
  };
  broadcasts: {
    list: (input?: ServiceCatalog["broadcasts.list"]["input"]) => Promise<ServiceCatalog["broadcasts.list"]["output"]>;
    pause: (input: ServiceCatalog["broadcasts.pause"]["input"]) => Promise<ServiceCatalog["broadcasts.pause"]["output"]>;
    recipients: (input: ServiceCatalog["broadcasts.recipients"]["input"]) => Promise<ServiceCatalog["broadcasts.recipients"]["output"]>;
    resume: (input: ServiceCatalog["broadcasts.resume"]["input"]) => Promise<ServiceCatalog["broadcasts.resume"]["output"]>;
    save: (input: ServiceCatalog["broadcasts.save"]["input"]) => Promise<ServiceCatalog["broadcasts.save"]["output"]>;
    start: (input: ServiceCatalog["broadcasts.start"]["input"]) => Promise<ServiceCatalog["broadcasts.start"]["output"]>;
    stats: (input: ServiceCatalog["broadcasts.stats"]["input"]) => Promise<ServiceCatalog["broadcasts.stats"]["output"]>;
    testSend: (input: ServiceCatalog["broadcasts.testSend"]["input"]) => Promise<ServiceCatalog["broadcasts.testSend"]["output"]>;
  };
  builder: {
    apply: (input: ServiceCatalog["builder.apply"]["input"]) => Promise<ServiceCatalog["builder.apply"]["output"]>;
    codeStatus: (input?: ServiceCatalog["builder.codeStatus"]["input"]) => Promise<ServiceCatalog["builder.codeStatus"]["output"]>;
    deliverCode: (input: ServiceCatalog["builder.deliverCode"]["input"]) => Promise<ServiceCatalog["builder.deliverCode"]["output"]>;
    getCodeProposal: (input: ServiceCatalog["builder.getCodeProposal"]["input"]) => Promise<ServiceCatalog["builder.getCodeProposal"]["output"]>;
    getProposal: (input: ServiceCatalog["builder.getProposal"]["input"]) => Promise<ServiceCatalog["builder.getProposal"]["output"]>;
    listCodeProposals: (input?: ServiceCatalog["builder.listCodeProposals"]["input"]) => Promise<ServiceCatalog["builder.listCodeProposals"]["output"]>;
    listProposals: (input?: ServiceCatalog["builder.listProposals"]["input"]) => Promise<ServiceCatalog["builder.listProposals"]["output"]>;
    propose: (input: ServiceCatalog["builder.propose"]["input"]) => Promise<ServiceCatalog["builder.propose"]["output"]>;
    proposeCode: (input: ServiceCatalog["builder.proposeCode"]["input"]) => Promise<ServiceCatalog["builder.proposeCode"]["output"]>;
    reject: (input: ServiceCatalog["builder.reject"]["input"]) => Promise<ServiceCatalog["builder.reject"]["output"]>;
    rejectCode: (input: ServiceCatalog["builder.rejectCode"]["input"]) => Promise<ServiceCatalog["builder.rejectCode"]["output"]>;
    rollback: (input: ServiceCatalog["builder.rollback"]["input"]) => Promise<ServiceCatalog["builder.rollback"]["output"]>;
    status: (input?: ServiceCatalog["builder.status"]["input"]) => Promise<ServiceCatalog["builder.status"]["output"]>;
  };
  calendars: {
    archive: (input: ServiceCatalog["calendars.archive"]["input"]) => Promise<ServiceCatalog["calendars.archive"]["output"]>;
    create: (input: ServiceCatalog["calendars.create"]["input"]) => Promise<ServiceCatalog["calendars.create"]["output"]>;
    feed: (input: ServiceCatalog["calendars.feed"]["input"]) => Promise<ServiceCatalog["calendars.feed"]["output"]>;
    forService: (input: ServiceCatalog["calendars.forService"]["input"]) => Promise<ServiceCatalog["calendars.forService"]["output"]>;
    get: (input: ServiceCatalog["calendars.get"]["input"]) => Promise<ServiceCatalog["calendars.get"]["output"]>;
    issueFeed: (input: ServiceCatalog["calendars.issueFeed"]["input"]) => Promise<ServiceCatalog["calendars.issueFeed"]["output"]>;
    list: (input?: ServiceCatalog["calendars.list"]["input"]) => Promise<ServiceCatalog["calendars.list"]["output"]>;
    revokeFeed: (input: ServiceCatalog["calendars.revokeFeed"]["input"]) => Promise<ServiceCatalog["calendars.revokeFeed"]["output"]>;
    setForService: (input: ServiceCatalog["calendars.setForService"]["input"]) => Promise<ServiceCatalog["calendars.setForService"]["output"]>;
    setIcsImport: (input: ServiceCatalog["calendars.setIcsImport"]["input"]) => Promise<ServiceCatalog["calendars.setIcsImport"]["output"]>;
    update: (input: ServiceCatalog["calendars.update"]["input"]) => Promise<ServiceCatalog["calendars.update"]["output"]>;
  };
  catalog: {
    abandonStaleCarts: (input?: ServiceCatalog["catalog.abandonStaleCarts"]["input"]) => Promise<ServiceCatalog["catalog.abandonStaleCarts"]["output"]>;
    activateProduct: (input: ServiceCatalog["catalog.activateProduct"]["input"]) => Promise<ServiceCatalog["catalog.activateProduct"]["output"]>;
    addBundleComponent: (input: ServiceCatalog["catalog.addBundleComponent"]["input"]) => Promise<ServiceCatalog["catalog.addBundleComponent"]["output"]>;
    addCartItem: (input: ServiceCatalog["catalog.addCartItem"]["input"]) => Promise<ServiceCatalog["catalog.addCartItem"]["output"]>;
    addOptionValue: (input: ServiceCatalog["catalog.addOptionValue"]["input"]) => Promise<ServiceCatalog["catalog.addOptionValue"]["output"]>;
    addProductRelation: (input: ServiceCatalog["catalog.addProductRelation"]["input"]) => Promise<ServiceCatalog["catalog.addProductRelation"]["output"]>;
    addPurchaseOrderLine: (input: ServiceCatalog["catalog.addPurchaseOrderLine"]["input"]) => Promise<ServiceCatalog["catalog.addPurchaseOrderLine"]["output"]>;
    addShippingRateBand: (input: ServiceCatalog["catalog.addShippingRateBand"]["input"]) => Promise<ServiceCatalog["catalog.addShippingRateBand"]["output"]>;
    addWishlistItem: (input: ServiceCatalog["catalog.addWishlistItem"]["input"]) => Promise<ServiceCatalog["catalog.addWishlistItem"]["output"]>;
    adjustStock: (input: ServiceCatalog["catalog.adjustStock"]["input"]) => Promise<ServiceCatalog["catalog.adjustStock"]["output"]>;
    applyCouponToCart: (input: ServiceCatalog["catalog.applyCouponToCart"]["input"]) => Promise<ServiceCatalog["catalog.applyCouponToCart"]["output"]>;
    applyGiftCardToInvoice: (input: ServiceCatalog["catalog.applyGiftCardToInvoice"]["input"]) => Promise<ServiceCatalog["catalog.applyGiftCardToInvoice"]["output"]>;
    applyVariantMatrix: (input: ServiceCatalog["catalog.applyVariantMatrix"]["input"]) => Promise<ServiceCatalog["catalog.applyVariantMatrix"]["output"]>;
    archiveProduct: (input: ServiceCatalog["catalog.archiveProduct"]["input"]) => Promise<ServiceCatalog["catalog.archiveProduct"]["output"]>;
    assignProductOption: (input: ServiceCatalog["catalog.assignProductOption"]["input"]) => Promise<ServiceCatalog["catalog.assignProductOption"]["output"]>;
    attachCartToContact: (input: ServiceCatalog["catalog.attachCartToContact"]["input"]) => Promise<ServiceCatalog["catalog.attachCartToContact"]["output"]>;
    attachProductMedia: (input: ServiceCatalog["catalog.attachProductMedia"]["input"]) => Promise<ServiceCatalog["catalog.attachProductMedia"]["output"]>;
    availability: (input: ServiceCatalog["catalog.availability"]["input"]) => Promise<ServiceCatalog["catalog.availability"]["output"]>;
    bookingRequirements: (input: ServiceCatalog["catalog.bookingRequirements"]["input"]) => Promise<ServiceCatalog["catalog.bookingRequirements"]["output"]>;
    bookingTerms: (input: ServiceCatalog["catalog.bookingTerms"]["input"]) => Promise<ServiceCatalog["catalog.bookingTerms"]["output"]>;
    cancelOrder: (input: ServiceCatalog["catalog.cancelOrder"]["input"]) => Promise<ServiceCatalog["catalog.cancelOrder"]["output"]>;
    cancelPurchaseOrder: (input: ServiceCatalog["catalog.cancelPurchaseOrder"]["input"]) => Promise<ServiceCatalog["catalog.cancelPurchaseOrder"]["output"]>;
    checkoutCart: (input: ServiceCatalog["catalog.checkoutCart"]["input"]) => Promise<ServiceCatalog["catalog.checkoutCart"]["output"]>;
    compareProducts: (input: ServiceCatalog["catalog.compareProducts"]["input"]) => Promise<ServiceCatalog["catalog.compareProducts"]["output"]>;
    consumeReservation: (input: ServiceCatalog["catalog.consumeReservation"]["input"]) => Promise<ServiceCatalog["catalog.consumeReservation"]["output"]>;
    countStock: (input: ServiceCatalog["catalog.countStock"]["input"]) => Promise<ServiceCatalog["catalog.countStock"]["output"]>;
    createAttributeDefinition: (input: ServiceCatalog["catalog.createAttributeDefinition"]["input"]) => Promise<ServiceCatalog["catalog.createAttributeDefinition"]["output"]>;
    createCancellationPolicy: (input: ServiceCatalog["catalog.createCancellationPolicy"]["input"]) => Promise<ServiceCatalog["catalog.createCancellationPolicy"]["output"]>;
    createCoupon: (input: ServiceCatalog["catalog.createCoupon"]["input"]) => Promise<ServiceCatalog["catalog.createCoupon"]["output"]>;
    createCustomerGroup: (input: ServiceCatalog["catalog.createCustomerGroup"]["input"]) => Promise<ServiceCatalog["catalog.createCustomerGroup"]["output"]>;
    createDeliveryWindow: (input: ServiceCatalog["catalog.createDeliveryWindow"]["input"]) => Promise<ServiceCatalog["catalog.createDeliveryWindow"]["output"]>;
    createFulfillment: (input: ServiceCatalog["catalog.createFulfillment"]["input"]) => Promise<ServiceCatalog["catalog.createFulfillment"]["output"]>;
    createOfferRule: (input: ServiceCatalog["catalog.createOfferRule"]["input"]) => Promise<ServiceCatalog["catalog.createOfferRule"]["output"]>;
    createOptionType: (input: ServiceCatalog["catalog.createOptionType"]["input"]) => Promise<ServiceCatalog["catalog.createOptionType"]["output"]>;
    createPackagingBox: (input: ServiceCatalog["catalog.createPackagingBox"]["input"]) => Promise<ServiceCatalog["catalog.createPackagingBox"]["output"]>;
    createPriceList: (input: ServiceCatalog["catalog.createPriceList"]["input"]) => Promise<ServiceCatalog["catalog.createPriceList"]["output"]>;
    createProduct: (input: ServiceCatalog["catalog.createProduct"]["input"]) => Promise<ServiceCatalog["catalog.createProduct"]["output"]>;
    createPurchaseOrder: (input: ServiceCatalog["catalog.createPurchaseOrder"]["input"]) => Promise<ServiceCatalog["catalog.createPurchaseOrder"]["output"]>;
    createShippingMethod: (input: ServiceCatalog["catalog.createShippingMethod"]["input"]) => Promise<ServiceCatalog["catalog.createShippingMethod"]["output"]>;
    createShippingZone: (input: ServiceCatalog["catalog.createShippingZone"]["input"]) => Promise<ServiceCatalog["catalog.createShippingZone"]["output"]>;
    createSupplier: (input: ServiceCatalog["catalog.createSupplier"]["input"]) => Promise<ServiceCatalog["catalog.createSupplier"]["output"]>;
    decideReturn: (input: ServiceCatalog["catalog.decideReturn"]["input"]) => Promise<ServiceCatalog["catalog.decideReturn"]["output"]>;
    deleteCancellationPolicy: (input: ServiceCatalog["catalog.deleteCancellationPolicy"]["input"]) => Promise<ServiceCatalog["catalog.deleteCancellationPolicy"]["output"]>;
    deliverFulfillment: (input: ServiceCatalog["catalog.deliverFulfillment"]["input"]) => Promise<ServiceCatalog["catalog.deliverFulfillment"]["output"]>;
    detachProductMedia: (input: ServiceCatalog["catalog.detachProductMedia"]["input"]) => Promise<ServiceCatalog["catalog.detachProductMedia"]["output"]>;
    enableInventory: (input: ServiceCatalog["catalog.enableInventory"]["input"]) => Promise<ServiceCatalog["catalog.enableInventory"]["output"]>;
    expireReservations: (input?: ServiceCatalog["catalog.expireReservations"]["input"]) => Promise<ServiceCatalog["catalog.expireReservations"]["output"]>;
    failFulfillment: (input: ServiceCatalog["catalog.failFulfillment"]["input"]) => Promise<ServiceCatalog["catalog.failFulfillment"]["output"]>;
    filterProductsByAttribute: (input: ServiceCatalog["catalog.filterProductsByAttribute"]["input"]) => Promise<ServiceCatalog["catalog.filterProductsByAttribute"]["output"]>;
    getCart: (input?: ServiceCatalog["catalog.getCart"]["input"]) => Promise<ServiceCatalog["catalog.getCart"]["output"]>;
    getFulfillment: (input: ServiceCatalog["catalog.getFulfillment"]["input"]) => Promise<ServiceCatalog["catalog.getFulfillment"]["output"]>;
    getOrCreateCart: (input: ServiceCatalog["catalog.getOrCreateCart"]["input"]) => Promise<ServiceCatalog["catalog.getOrCreateCart"]["output"]>;
    getOrder: (input: ServiceCatalog["catalog.getOrder"]["input"]) => Promise<ServiceCatalog["catalog.getOrder"]["output"]>;
    getProduct: (input: ServiceCatalog["catalog.getProduct"]["input"]) => Promise<ServiceCatalog["catalog.getProduct"]["output"]>;
    getProductVariants: (input: ServiceCatalog["catalog.getProductVariants"]["input"]) => Promise<ServiceCatalog["catalog.getProductVariants"]["output"]>;
    getReturn: (input: ServiceCatalog["catalog.getReturn"]["input"]) => Promise<ServiceCatalog["catalog.getReturn"]["output"]>;
    getServiceOffering: (input: ServiceCatalog["catalog.getServiceOffering"]["input"]) => Promise<ServiceCatalog["catalog.getServiceOffering"]["output"]>;
    giftCardByShareToken: (input: ServiceCatalog["catalog.giftCardByShareToken"]["input"]) => Promise<ServiceCatalog["catalog.giftCardByShareToken"]["output"]>;
    grantDigitalFulfillment: (input: ServiceCatalog["catalog.grantDigitalFulfillment"]["input"]) => Promise<ServiceCatalog["catalog.grantDigitalFulfillment"]["output"]>;
    issueGiftCard: (input: ServiceCatalog["catalog.issueGiftCard"]["input"]) => Promise<ServiceCatalog["catalog.issueGiftCard"]["output"]>;
    listAttributeDefinitions: (input?: ServiceCatalog["catalog.listAttributeDefinitions"]["input"]) => Promise<ServiceCatalog["catalog.listAttributeDefinitions"]["output"]>;
    listBundleComponents: (input: ServiceCatalog["catalog.listBundleComponents"]["input"]) => Promise<ServiceCatalog["catalog.listBundleComponents"]["output"]>;
    listCancellationPolicies: (input?: ServiceCatalog["catalog.listCancellationPolicies"]["input"]) => Promise<ServiceCatalog["catalog.listCancellationPolicies"]["output"]>;
    listCartOffers: (input: ServiceCatalog["catalog.listCartOffers"]["input"]) => Promise<ServiceCatalog["catalog.listCartOffers"]["output"]>;
    listCarts: (input?: ServiceCatalog["catalog.listCarts"]["input"]) => Promise<ServiceCatalog["catalog.listCarts"]["output"]>;
    listCoupons: (input?: ServiceCatalog["catalog.listCoupons"]["input"]) => Promise<ServiceCatalog["catalog.listCoupons"]["output"]>;
    listCustomerGroups: (input?: ServiceCatalog["catalog.listCustomerGroups"]["input"]) => Promise<ServiceCatalog["catalog.listCustomerGroups"]["output"]>;
    listDigitalDeliveries: (input: ServiceCatalog["catalog.listDigitalDeliveries"]["input"]) => Promise<ServiceCatalog["catalog.listDigitalDeliveries"]["output"]>;
    listFulfillmentQueue: (input?: ServiceCatalog["catalog.listFulfillmentQueue"]["input"]) => Promise<ServiceCatalog["catalog.listFulfillmentQueue"]["output"]>;
    listFulfillments: (input?: ServiceCatalog["catalog.listFulfillments"]["input"]) => Promise<ServiceCatalog["catalog.listFulfillments"]["output"]>;
    listGiftCards: (input?: ServiceCatalog["catalog.listGiftCards"]["input"]) => Promise<ServiceCatalog["catalog.listGiftCards"]["output"]>;
    listInventory: (input?: ServiceCatalog["catalog.listInventory"]["input"]) => Promise<ServiceCatalog["catalog.listInventory"]["output"]>;
    listOfferRules: (input?: ServiceCatalog["catalog.listOfferRules"]["input"]) => Promise<ServiceCatalog["catalog.listOfferRules"]["output"]>;
    listOptionTypes: (input?: ServiceCatalog["catalog.listOptionTypes"]["input"]) => Promise<ServiceCatalog["catalog.listOptionTypes"]["output"]>;
    listOrders: (input?: ServiceCatalog["catalog.listOrders"]["input"]) => Promise<ServiceCatalog["catalog.listOrders"]["output"]>;
    listPriceLists: (input?: ServiceCatalog["catalog.listPriceLists"]["input"]) => Promise<ServiceCatalog["catalog.listPriceLists"]["output"]>;
    listPriceRules: (input: ServiceCatalog["catalog.listPriceRules"]["input"]) => Promise<ServiceCatalog["catalog.listPriceRules"]["output"]>;
    listProductAttributes: (input: ServiceCatalog["catalog.listProductAttributes"]["input"]) => Promise<ServiceCatalog["catalog.listProductAttributes"]["output"]>;
    listProductMedia: (input: ServiceCatalog["catalog.listProductMedia"]["input"]) => Promise<ServiceCatalog["catalog.listProductMedia"]["output"]>;
    listProductRelations: (input: ServiceCatalog["catalog.listProductRelations"]["input"]) => Promise<ServiceCatalog["catalog.listProductRelations"]["output"]>;
    listProducts: (input?: ServiceCatalog["catalog.listProducts"]["input"]) => Promise<ServiceCatalog["catalog.listProducts"]["output"]>;
    listPurchaseOrders: (input?: ServiceCatalog["catalog.listPurchaseOrders"]["input"]) => Promise<ServiceCatalog["catalog.listPurchaseOrders"]["output"]>;
    listReorderQueue: (input?: ServiceCatalog["catalog.listReorderQueue"]["input"]) => Promise<ServiceCatalog["catalog.listReorderQueue"]["output"]>;
    listReservations: (input: ServiceCatalog["catalog.listReservations"]["input"]) => Promise<ServiceCatalog["catalog.listReservations"]["output"]>;
    listReturns: (input?: ServiceCatalog["catalog.listReturns"]["input"]) => Promise<ServiceCatalog["catalog.listReturns"]["output"]>;
    listSavedCarts: (input: ServiceCatalog["catalog.listSavedCarts"]["input"]) => Promise<ServiceCatalog["catalog.listSavedCarts"]["output"]>;
    listSellableVariants: (input?: ServiceCatalog["catalog.listSellableVariants"]["input"]) => Promise<ServiceCatalog["catalog.listSellableVariants"]["output"]>;
    listShippingCatalog: (input?: ServiceCatalog["catalog.listShippingCatalog"]["input"]) => Promise<ServiceCatalog["catalog.listShippingCatalog"]["output"]>;
    listShippingZones: (input?: ServiceCatalog["catalog.listShippingZones"]["input"]) => Promise<ServiceCatalog["catalog.listShippingZones"]["output"]>;
    listStockMovements: (input: ServiceCatalog["catalog.listStockMovements"]["input"]) => Promise<ServiceCatalog["catalog.listStockMovements"]["output"]>;
    listSuppliers: (input?: ServiceCatalog["catalog.listSuppliers"]["input"]) => Promise<ServiceCatalog["catalog.listSuppliers"]["output"]>;
    listTaxCategories: (input?: ServiceCatalog["catalog.listTaxCategories"]["input"]) => Promise<ServiceCatalog["catalog.listTaxCategories"]["output"]>;
    listTrackedVariantChoices: (input?: ServiceCatalog["catalog.listTrackedVariantChoices"]["input"]) => Promise<ServiceCatalog["catalog.listTrackedVariantChoices"]["output"]>;
    listVisibleProducts: (input?: ServiceCatalog["catalog.listVisibleProducts"]["input"]) => Promise<ServiceCatalog["catalog.listVisibleProducts"]["output"]>;
    listWishlist: (input?: ServiceCatalog["catalog.listWishlist"]["input"]) => Promise<ServiceCatalog["catalog.listWishlist"]["output"]>;
    loadDemoFixture: (input: ServiceCatalog["catalog.loadDemoFixture"]["input"]) => Promise<ServiceCatalog["catalog.loadDemoFixture"]["output"]>;
    packFulfillment: (input: ServiceCatalog["catalog.packFulfillment"]["input"]) => Promise<ServiceCatalog["catalog.packFulfillment"]["output"]>;
    payOrder: (input: ServiceCatalog["catalog.payOrder"]["input"]) => Promise<ServiceCatalog["catalog.payOrder"]["output"]>;
    placePurchaseOrder: (input: ServiceCatalog["catalog.placePurchaseOrder"]["input"]) => Promise<ServiceCatalog["catalog.placePurchaseOrder"]["output"]>;
    publishProduct: (input: ServiceCatalog["catalog.publishProduct"]["input"]) => Promise<ServiceCatalog["catalog.publishProduct"]["output"]>;
    purgeDemoFixture: (input: ServiceCatalog["catalog.purgeDemoFixture"]["input"]) => Promise<ServiceCatalog["catalog.purgeDemoFixture"]["output"]>;
    quoteBundle: (input: ServiceCatalog["catalog.quoteBundle"]["input"]) => Promise<ServiceCatalog["catalog.quoteBundle"]["output"]>;
    quoteCartPromotions: (input: ServiceCatalog["catalog.quoteCartPromotions"]["input"]) => Promise<ServiceCatalog["catalog.quoteCartPromotions"]["output"]>;
    quoteServicePayment: (input: ServiceCatalog["catalog.quoteServicePayment"]["input"]) => Promise<ServiceCatalog["catalog.quoteServicePayment"]["output"]>;
    quoteShipping: (input: ServiceCatalog["catalog.quoteShipping"]["input"]) => Promise<ServiceCatalog["catalog.quoteShipping"]["output"]>;
    receivePurchaseOrderLine: (input: ServiceCatalog["catalog.receivePurchaseOrderLine"]["input"]) => Promise<ServiceCatalog["catalog.receivePurchaseOrderLine"]["output"]>;
    receiveReturn: (input: ServiceCatalog["catalog.receiveReturn"]["input"]) => Promise<ServiceCatalog["catalog.receiveReturn"]["output"]>;
    recordCouponRedemption: (input: ServiceCatalog["catalog.recordCouponRedemption"]["input"]) => Promise<ServiceCatalog["catalog.recordCouponRedemption"]["output"]>;
    recordDamage: (input: ServiceCatalog["catalog.recordDamage"]["input"]) => Promise<ServiceCatalog["catalog.recordDamage"]["output"]>;
    recordStockMovement: (input: ServiceCatalog["catalog.recordStockMovement"]["input"]) => Promise<ServiceCatalog["catalog.recordStockMovement"]["output"]>;
    recoverAbandonedCarts: (input?: ServiceCatalog["catalog.recoverAbandonedCarts"]["input"]) => Promise<ServiceCatalog["catalog.recoverAbandonedCarts"]["output"]>;
    refundReturn: (input: ServiceCatalog["catalog.refundReturn"]["input"]) => Promise<ServiceCatalog["catalog.refundReturn"]["output"]>;
    releaseReservation: (input: ServiceCatalog["catalog.releaseReservation"]["input"]) => Promise<ServiceCatalog["catalog.releaseReservation"]["output"]>;
    removeBundleComponent: (input: ServiceCatalog["catalog.removeBundleComponent"]["input"]) => Promise<ServiceCatalog["catalog.removeBundleComponent"]["output"]>;
    removeCartItem: (input: ServiceCatalog["catalog.removeCartItem"]["input"]) => Promise<ServiceCatalog["catalog.removeCartItem"]["output"]>;
    removePriceRule: (input: ServiceCatalog["catalog.removePriceRule"]["input"]) => Promise<ServiceCatalog["catalog.removePriceRule"]["output"]>;
    removeProductRelation: (input: ServiceCatalog["catalog.removeProductRelation"]["input"]) => Promise<ServiceCatalog["catalog.removeProductRelation"]["output"]>;
    removeWishlistItem: (input: ServiceCatalog["catalog.removeWishlistItem"]["input"]) => Promise<ServiceCatalog["catalog.removeWishlistItem"]["output"]>;
    requestReturn: (input: ServiceCatalog["catalog.requestReturn"]["input"]) => Promise<ServiceCatalog["catalog.requestReturn"]["output"]>;
    reserveStock: (input: ServiceCatalog["catalog.reserveStock"]["input"]) => Promise<ServiceCatalog["catalog.reserveStock"]["output"]>;
    resolvePrice: (input: ServiceCatalog["catalog.resolvePrice"]["input"]) => Promise<ServiceCatalog["catalog.resolvePrice"]["output"]>;
    resolveVisibleProduct: (input: ServiceCatalog["catalog.resolveVisibleProduct"]["input"]) => Promise<ServiceCatalog["catalog.resolveVisibleProduct"]["output"]>;
    restoreProduct: (input: ServiceCatalog["catalog.restoreProduct"]["input"]) => Promise<ServiceCatalog["catalog.restoreProduct"]["output"]>;
    revokeWishlistShare: (input?: ServiceCatalog["catalog.revokeWishlistShare"]["input"]) => Promise<ServiceCatalog["catalog.revokeWishlistShare"]["output"]>;
    saveCart: (input: ServiceCatalog["catalog.saveCart"]["input"]) => Promise<ServiceCatalog["catalog.saveCart"]["output"]>;
    sendGiftCard: (input: ServiceCatalog["catalog.sendGiftCard"]["input"]) => Promise<ServiceCatalog["catalog.sendGiftCard"]["output"]>;
    setCartItemQuantity: (input: ServiceCatalog["catalog.setCartItemQuantity"]["input"]) => Promise<ServiceCatalog["catalog.setCartItemQuantity"]["output"]>;
    setDefaultVariant: (input: ServiceCatalog["catalog.setDefaultVariant"]["input"]) => Promise<ServiceCatalog["catalog.setDefaultVariant"]["output"]>;
    setInventoryLevels: (input: ServiceCatalog["catalog.setInventoryLevels"]["input"]) => Promise<ServiceCatalog["catalog.setInventoryLevels"]["output"]>;
    setPriceBreak: (input: ServiceCatalog["catalog.setPriceBreak"]["input"]) => Promise<ServiceCatalog["catalog.setPriceBreak"]["output"]>;
    setPriceListEntry: (input: ServiceCatalog["catalog.setPriceListEntry"]["input"]) => Promise<ServiceCatalog["catalog.setPriceListEntry"]["output"]>;
    setPriceRule: (input: ServiceCatalog["catalog.setPriceRule"]["input"]) => Promise<ServiceCatalog["catalog.setPriceRule"]["output"]>;
    setProductAttribute: (input: ServiceCatalog["catalog.setProductAttribute"]["input"]) => Promise<ServiceCatalog["catalog.setProductAttribute"]["output"]>;
    setProductOptionValues: (input: ServiceCatalog["catalog.setProductOptionValues"]["input"]) => Promise<ServiceCatalog["catalog.setProductOptionValues"]["output"]>;
    setVariantStockPolicy: (input: ServiceCatalog["catalog.setVariantStockPolicy"]["input"]) => Promise<ServiceCatalog["catalog.setVariantStockPolicy"]["output"]>;
    shareWishlist: (input?: ServiceCatalog["catalog.shareWishlist"]["input"]) => Promise<ServiceCatalog["catalog.shareWishlist"]["output"]>;
    shipFulfillment: (input: ServiceCatalog["catalog.shipFulfillment"]["input"]) => Promise<ServiceCatalog["catalog.shipFulfillment"]["output"]>;
    subscribeBackInStock: (input: ServiceCatalog["catalog.subscribeBackInStock"]["input"]) => Promise<ServiceCatalog["catalog.subscribeBackInStock"]["output"]>;
    transferStock: (input: ServiceCatalog["catalog.transferStock"]["input"]) => Promise<ServiceCatalog["catalog.transferStock"]["output"]>;
    updateProduct: (input: ServiceCatalog["catalog.updateProduct"]["input"]) => Promise<ServiceCatalog["catalog.updateProduct"]["output"]>;
    updateProductDescription: (input: ServiceCatalog["catalog.updateProductDescription"]["input"]) => Promise<ServiceCatalog["catalog.updateProductDescription"]["output"]>;
    upsertServiceOffering: (input: ServiceCatalog["catalog.upsertServiceOffering"]["input"]) => Promise<ServiceCatalog["catalog.upsertServiceOffering"]["output"]>;
    verifyDemoFixture: (input: ServiceCatalog["catalog.verifyDemoFixture"]["input"]) => Promise<ServiceCatalog["catalog.verifyDemoFixture"]["output"]>;
    wishlistByShareToken: (input: ServiceCatalog["catalog.wishlistByShareToken"]["input"]) => Promise<ServiceCatalog["catalog.wishlistByShareToken"]["output"]>;
  };
  catalogue: {
    addSource: (input: ServiceCatalog["catalogue.addSource"]["input"]) => Promise<ServiceCatalog["catalogue.addSource"]["output"]>;
    install: (input: ServiceCatalog["catalogue.install"]["input"]) => Promise<ServiceCatalog["catalogue.install"]["output"]>;
    installs: (input?: ServiceCatalog["catalogue.installs"]["input"]) => Promise<ServiceCatalog["catalogue.installs"]["output"]>;
    list: (input?: ServiceCatalog["catalogue.list"]["input"]) => Promise<ServiceCatalog["catalogue.list"]["output"]>;
    preview: (input: ServiceCatalog["catalogue.preview"]["input"]) => Promise<ServiceCatalog["catalogue.preview"]["output"]>;
    refresh: (input: ServiceCatalog["catalogue.refresh"]["input"]) => Promise<ServiceCatalog["catalogue.refresh"]["output"]>;
    removeSource: (input: ServiceCatalog["catalogue.removeSource"]["input"]) => Promise<ServiceCatalog["catalogue.removeSource"]["output"]>;
    sources: (input?: ServiceCatalog["catalogue.sources"]["input"]) => Promise<ServiceCatalog["catalogue.sources"]["output"]>;
  };
  cms: {
    addComment: (input: ServiceCatalog["cms.addComment"]["input"]) => Promise<ServiceCatalog["cms.addComment"]["output"]>;
    applyDueSchedules: (input?: ServiceCatalog["cms.applyDueSchedules"]["input"]) => Promise<ServiceCatalog["cms.applyDueSchedules"]["output"]>;
    attachLayout: (input: ServiceCatalog["cms.attachLayout"]["input"]) => Promise<ServiceCatalog["cms.attachLayout"]["output"]>;
    compareRevisions: (input?: ServiceCatalog["cms.compareRevisions"]["input"]) => Promise<ServiceCatalog["cms.compareRevisions"]["output"]>;
    createFromTemplate: (input: ServiceCatalog["cms.createFromTemplate"]["input"]) => Promise<ServiceCatalog["cms.createFromTemplate"]["output"]>;
    createPage: (input: ServiceCatalog["cms.createPage"]["input"]) => Promise<ServiceCatalog["cms.createPage"]["output"]>;
    createPreviewLink: (input: ServiceCatalog["cms.createPreviewLink"]["input"]) => Promise<ServiceCatalog["cms.createPreviewLink"]["output"]>;
    createSection: (input: ServiceCatalog["cms.createSection"]["input"]) => Promise<ServiceCatalog["cms.createSection"]["output"]>;
    createSectionLocale: (input: ServiceCatalog["cms.createSectionLocale"]["input"]) => Promise<ServiceCatalog["cms.createSectionLocale"]["output"]>;
    decideApproval: (input: ServiceCatalog["cms.decideApproval"]["input"]) => Promise<ServiceCatalog["cms.decideApproval"]["output"]>;
    decideReview: (input: ServiceCatalog["cms.decideReview"]["input"]) => Promise<ServiceCatalog["cms.decideReview"]["output"]>;
    deleteDraftPage: (input: ServiceCatalog["cms.deleteDraftPage"]["input"]) => Promise<ServiceCatalog["cms.deleteDraftPage"]["output"]>;
    deleteHelpCategory: (input: ServiceCatalog["cms.deleteHelpCategory"]["input"]) => Promise<ServiceCatalog["cms.deleteHelpCategory"]["output"]>;
    deleteSection: (input: ServiceCatalog["cms.deleteSection"]["input"]) => Promise<ServiceCatalog["cms.deleteSection"]["output"]>;
    describeConflict: (input: ServiceCatalog["cms.describeConflict"]["input"]) => Promise<ServiceCatalog["cms.describeConflict"]["output"]>;
    detachLayout: (input: ServiceCatalog["cms.detachLayout"]["input"]) => Promise<ServiceCatalog["cms.detachLayout"]["output"]>;
    detachSection: (input: ServiceCatalog["cms.detachSection"]["input"]) => Promise<ServiceCatalog["cms.detachSection"]["output"]>;
    draftPageTranslation: (input: ServiceCatalog["cms.draftPageTranslation"]["input"]) => Promise<ServiceCatalog["cms.draftPageTranslation"]["output"]>;
    ensureDefaults: (input?: ServiceCatalog["cms.ensureDefaults"]["input"]) => Promise<ServiceCatalog["cms.ensureDefaults"]["output"]>;
    ensureTemplates: (input?: ServiceCatalog["cms.ensureTemplates"]["input"]) => Promise<ServiceCatalog["cms.ensureTemplates"]["output"]>;
    expireStalePresence: (input?: ServiceCatalog["cms.expireStalePresence"]["input"]) => Promise<ServiceCatalog["cms.expireStalePresence"]["output"]>;
    fileHelpArticle: (input: ServiceCatalog["cms.fileHelpArticle"]["input"]) => Promise<ServiceCatalog["cms.fileHelpArticle"]["output"]>;
    getLayout: (input: ServiceCatalog["cms.getLayout"]["input"]) => Promise<ServiceCatalog["cms.getLayout"]["output"]>;
    getPage: (input: ServiceCatalog["cms.getPage"]["input"]) => Promise<ServiceCatalog["cms.getPage"]["output"]>;
    getSection: (input: ServiceCatalog["cms.getSection"]["input"]) => Promise<ServiceCatalog["cms.getSection"]["output"]>;
    getTemplate: (input: ServiceCatalog["cms.getTemplate"]["input"]) => Promise<ServiceCatalog["cms.getTemplate"]["output"]>;
    heartbeatPresence: (input: ServiceCatalog["cms.heartbeatPresence"]["input"]) => Promise<ServiceCatalog["cms.heartbeatPresence"]["output"]>;
    helpArticleAt: (input: ServiceCatalog["cms.helpArticleAt"]["input"]) => Promise<ServiceCatalog["cms.helpArticleAt"]["output"]>;
    helpArticleFeedback: (input?: ServiceCatalog["cms.helpArticleFeedback"]["input"]) => Promise<ServiceCatalog["cms.helpArticleFeedback"]["output"]>;
    helpArticles: (input?: ServiceCatalog["cms.helpArticles"]["input"]) => Promise<ServiceCatalog["cms.helpArticles"]["output"]>;
    helpCategories: (input?: ServiceCatalog["cms.helpCategories"]["input"]) => Promise<ServiceCatalog["cms.helpCategories"]["output"]>;
    leavePresence: (input: ServiceCatalog["cms.leavePresence"]["input"]) => Promise<ServiceCatalog["cms.leavePresence"]["output"]>;
    listComments: (input: ServiceCatalog["cms.listComments"]["input"]) => Promise<ServiceCatalog["cms.listComments"]["output"]>;
    listPages: (input?: ServiceCatalog["cms.listPages"]["input"]) => Promise<ServiceCatalog["cms.listPages"]["output"]>;
    listPresence: (input: ServiceCatalog["cms.listPresence"]["input"]) => Promise<ServiceCatalog["cms.listPresence"]["output"]>;
    listPreviewLinks: (input: ServiceCatalog["cms.listPreviewLinks"]["input"]) => Promise<ServiceCatalog["cms.listPreviewLinks"]["output"]>;
    listRevisions: (input: ServiceCatalog["cms.listRevisions"]["input"]) => Promise<ServiceCatalog["cms.listRevisions"]["output"]>;
    listSectionUsages: (input: ServiceCatalog["cms.listSectionUsages"]["input"]) => Promise<ServiceCatalog["cms.listSectionUsages"]["output"]>;
    listSections: (input?: ServiceCatalog["cms.listSections"]["input"]) => Promise<ServiceCatalog["cms.listSections"]["output"]>;
    listTemplates: (input?: ServiceCatalog["cms.listTemplates"]["input"]) => Promise<ServiceCatalog["cms.listTemplates"]["output"]>;
    loadDemoFixture: (input: ServiceCatalog["cms.loadDemoFixture"]["input"]) => Promise<ServiceCatalog["cms.loadDemoFixture"]["output"]>;
    mergePage: (input: ServiceCatalog["cms.mergePage"]["input"]) => Promise<ServiceCatalog["cms.mergePage"]["output"]>;
    nameRevision: (input: ServiceCatalog["cms.nameRevision"]["input"]) => Promise<ServiceCatalog["cms.nameRevision"]["output"]>;
    pageAccessibilityReport: (input: ServiceCatalog["cms.pageAccessibilityReport"]["input"]) => Promise<ServiceCatalog["cms.pageAccessibilityReport"]["output"]>;
    pageAuthorSummary: (input: ServiceCatalog["cms.pageAuthorSummary"]["input"]) => Promise<ServiceCatalog["cms.pageAuthorSummary"]["output"]>;
    pageTranslationReport: (input: ServiceCatalog["cms.pageTranslationReport"]["input"]) => Promise<ServiceCatalog["cms.pageTranslationReport"]["output"]>;
    previewEmail: (input: ServiceCatalog["cms.previewEmail"]["input"]) => Promise<ServiceCatalog["cms.previewEmail"]["output"]>;
    previewSms: (input: ServiceCatalog["cms.previewSms"]["input"]) => Promise<ServiceCatalog["cms.previewSms"]["output"]>;
    previewTemplate: (input: ServiceCatalog["cms.previewTemplate"]["input"]) => Promise<ServiceCatalog["cms.previewTemplate"]["output"]>;
    publishPage: (input: ServiceCatalog["cms.publishPage"]["input"]) => Promise<ServiceCatalog["cms.publishPage"]["output"]>;
    publishedPaths: (input?: ServiceCatalog["cms.publishedPaths"]["input"]) => Promise<ServiceCatalog["cms.publishedPaths"]["output"]>;
    purgeDemoFixture: (input: ServiceCatalog["cms.purgeDemoFixture"]["input"]) => Promise<ServiceCatalog["cms.purgeDemoFixture"]["output"]>;
    rateHelpArticle: (input: ServiceCatalog["cms.rateHelpArticle"]["input"]) => Promise<ServiceCatalog["cms.rateHelpArticle"]["output"]>;
    rejoinLayout: (input: ServiceCatalog["cms.rejoinLayout"]["input"]) => Promise<ServiceCatalog["cms.rejoinLayout"]["output"]>;
    releaseEditLease: (input: ServiceCatalog["cms.releaseEditLease"]["input"]) => Promise<ServiceCatalog["cms.releaseEditLease"]["output"]>;
    reloadWorkingDraft: (input: ServiceCatalog["cms.reloadWorkingDraft"]["input"]) => Promise<ServiceCatalog["cms.reloadWorkingDraft"]["output"]>;
    reopenThread: (input: ServiceCatalog["cms.reopenThread"]["input"]) => Promise<ServiceCatalog["cms.reopenThread"]["output"]>;
    requestApproval: (input: ServiceCatalog["cms.requestApproval"]["input"]) => Promise<ServiceCatalog["cms.requestApproval"]["output"]>;
    requestReview: (input: ServiceCatalog["cms.requestReview"]["input"]) => Promise<ServiceCatalog["cms.requestReview"]["output"]>;
    resetTemplate: (input: ServiceCatalog["cms.resetTemplate"]["input"]) => Promise<ServiceCatalog["cms.resetTemplate"]["output"]>;
    resolvePage: (input: ServiceCatalog["cms.resolvePage"]["input"]) => Promise<ServiceCatalog["cms.resolvePage"]["output"]>;
    resolvePreviewLink: (input: ServiceCatalog["cms.resolvePreviewLink"]["input"]) => Promise<ServiceCatalog["cms.resolvePreviewLink"]["output"]>;
    resolveThread: (input: ServiceCatalog["cms.resolveThread"]["input"]) => Promise<ServiceCatalog["cms.resolveThread"]["output"]>;
    restoreRevision: (input: ServiceCatalog["cms.restoreRevision"]["input"]) => Promise<ServiceCatalog["cms.restoreRevision"]["output"]>;
    revokePreviewLink: (input: ServiceCatalog["cms.revokePreviewLink"]["input"]) => Promise<ServiceCatalog["cms.revokePreviewLink"]["output"]>;
    saveAsSection: (input: ServiceCatalog["cms.saveAsSection"]["input"]) => Promise<ServiceCatalog["cms.saveAsSection"]["output"]>;
    saveHelpCategory: (input: ServiceCatalog["cms.saveHelpCategory"]["input"]) => Promise<ServiceCatalog["cms.saveHelpCategory"]["output"]>;
    schedulePage: (input: ServiceCatalog["cms.schedulePage"]["input"]) => Promise<ServiceCatalog["cms.schedulePage"]["output"]>;
    searchHelp: (input: ServiceCatalog["cms.searchHelp"]["input"]) => Promise<ServiceCatalog["cms.searchHelp"]["output"]>;
    sendSmsTemplate: (input: ServiceCatalog["cms.sendSmsTemplate"]["input"]) => Promise<ServiceCatalog["cms.sendSmsTemplate"]["output"]>;
    snapshotRevision: (input: ServiceCatalog["cms.snapshotRevision"]["input"]) => Promise<ServiceCatalog["cms.snapshotRevision"]["output"]>;
    submitQuoteRequest: (input: ServiceCatalog["cms.submitQuoteRequest"]["input"]) => Promise<ServiceCatalog["cms.submitQuoteRequest"]["output"]>;
    submitSiteChat: (input: ServiceCatalog["cms.submitSiteChat"]["input"]) => Promise<ServiceCatalog["cms.submitSiteChat"]["output"]>;
    submitTipIntent: (input: ServiceCatalog["cms.submitTipIntent"]["input"]) => Promise<ServiceCatalog["cms.submitTipIntent"]["output"]>;
    testSendEmail: (input: ServiceCatalog["cms.testSendEmail"]["input"]) => Promise<ServiceCatalog["cms.testSendEmail"]["output"]>;
    testSendSms: (input: ServiceCatalog["cms.testSendSms"]["input"]) => Promise<ServiceCatalog["cms.testSendSms"]["output"]>;
    touchEditLease: (input: ServiceCatalog["cms.touchEditLease"]["input"]) => Promise<ServiceCatalog["cms.touchEditLease"]["output"]>;
    updatePage: (input: ServiceCatalog["cms.updatePage"]["input"]) => Promise<ServiceCatalog["cms.updatePage"]["output"]>;
    updateSection: (input: ServiceCatalog["cms.updateSection"]["input"]) => Promise<ServiceCatalog["cms.updateSection"]["output"]>;
    updateTemplate: (input: ServiceCatalog["cms.updateTemplate"]["input"]) => Promise<ServiceCatalog["cms.updateTemplate"]["output"]>;
    verifyDemoFixture: (input: ServiceCatalog["cms.verifyDemoFixture"]["input"]) => Promise<ServiceCatalog["cms.verifyDemoFixture"]["output"]>;
  };
  community: {
    createSpace: (input: ServiceCatalog["community.createSpace"]["input"]) => Promise<ServiceCatalog["community.createSpace"]["output"]>;
    getBySlug: (input: ServiceCatalog["community.getBySlug"]["input"]) => Promise<ServiceCatalog["community.getBySlug"]["output"]>;
    join: (input: ServiceCatalog["community.join"]["input"]) => Promise<ServiceCatalog["community.join"]["output"]>;
    joinBySlug: (input: ServiceCatalog["community.joinBySlug"]["input"]) => Promise<ServiceCatalog["community.joinBySlug"]["output"]>;
    listMembers: (input: ServiceCatalog["community.listMembers"]["input"]) => Promise<ServiceCatalog["community.listMembers"]["output"]>;
    listSpaces: (input?: ServiceCatalog["community.listSpaces"]["input"]) => Promise<ServiceCatalog["community.listSpaces"]["output"]>;
  };
  connections: {
    beginCalendarOAuth: (input: ServiceCatalog["connections.beginCalendarOAuth"]["input"]) => Promise<ServiceCatalog["connections.beginCalendarOAuth"]["output"]>;
    beginMailReadOAuth: (input: ServiceCatalog["connections.beginMailReadOAuth"]["input"]) => Promise<ServiceCatalog["connections.beginMailReadOAuth"]["output"]>;
    busyWindows: (input: ServiceCatalog["connections.busyWindows"]["input"]) => Promise<ServiceCatalog["connections.busyWindows"]["output"]>;
    calendarSources: (input?: ServiceCatalog["connections.calendarSources"]["input"]) => Promise<ServiceCatalog["connections.calendarSources"]["output"]>;
    completeCalendarOAuth: (input: ServiceCatalog["connections.completeCalendarOAuth"]["input"]) => Promise<ServiceCatalog["connections.completeCalendarOAuth"]["output"]>;
    completeMailReadOAuth: (input: ServiceCatalog["connections.completeMailReadOAuth"]["input"]) => Promise<ServiceCatalog["connections.completeMailReadOAuth"]["output"]>;
    flag: (input: ServiceCatalog["connections.flag"]["input"]) => Promise<ServiceCatalog["connections.flag"]["output"]>;
    grantToAgent: (input: ServiceCatalog["connections.grantToAgent"]["input"]) => Promise<ServiceCatalog["connections.grantToAgent"]["output"]>;
    grants: (input?: ServiceCatalog["connections.grants"]["input"]) => Promise<ServiceCatalog["connections.grants"]["output"]>;
    importMail: (input: ServiceCatalog["connections.importMail"]["input"]) => Promise<ServiceCatalog["connections.importMail"]["output"]>;
    list: (input?: ServiceCatalog["connections.list"]["input"]) => Promise<ServiceCatalog["connections.list"]["output"]>;
    listCalendars: (input: ServiceCatalog["connections.listCalendars"]["input"]) => Promise<ServiceCatalog["connections.listCalendars"]["output"]>;
    mine: (input?: ServiceCatalog["connections.mine"]["input"]) => Promise<ServiceCatalog["connections.mine"]["output"]>;
    record: (input: ServiceCatalog["connections.record"]["input"]) => Promise<ServiceCatalog["connections.record"]["output"]>;
    remove: (input: ServiceCatalog["connections.remove"]["input"]) => Promise<ServiceCatalog["connections.remove"]["output"]>;
    revokeFromAgent: (input: ServiceCatalog["connections.revokeFromAgent"]["input"]) => Promise<ServiceCatalog["connections.revokeFromAgent"]["output"]>;
    rotateCredentials: (input?: ServiceCatalog["connections.rotateCredentials"]["input"]) => Promise<ServiceCatalog["connections.rotateCredentials"]["output"]>;
    setCalendarRole: (input: ServiceCatalog["connections.setCalendarRole"]["input"]) => Promise<ServiceCatalog["connections.setCalendarRole"]["output"]>;
    setCapability: (input: ServiceCatalog["connections.setCapability"]["input"]) => Promise<ServiceCatalog["connections.setCapability"]["output"]>;
    setOptions: (input: ServiceCatalog["connections.setOptions"]["input"]) => Promise<ServiceCatalog["connections.setOptions"]["output"]>;
    syncCalendars: (input: ServiceCatalog["connections.syncCalendars"]["input"]) => Promise<ServiceCatalog["connections.syncCalendars"]["output"]>;
  };
  contactImports: {
    begin: (input: ServiceCatalog["contactImports.begin"]["input"]) => Promise<ServiceCatalog["contactImports.begin"]["output"]>;
    commit: (input: ServiceCatalog["contactImports.commit"]["input"]) => Promise<ServiceCatalog["contactImports.commit"]["output"]>;
    get: (input: ServiceCatalog["contactImports.get"]["input"]) => Promise<ServiceCatalog["contactImports.get"]["output"]>;
    list: (input?: ServiceCatalog["contactImports.list"]["input"]) => Promise<ServiceCatalog["contactImports.list"]["output"]>;
    map: (input: ServiceCatalog["contactImports.map"]["input"]) => Promise<ServiceCatalog["contactImports.map"]["output"]>;
    revert: (input: ServiceCatalog["contactImports.revert"]["input"]) => Promise<ServiceCatalog["contactImports.revert"]["output"]>;
  };
  contacts: {
    addPrivacyRetentionException: (input: ServiceCatalog["contacts.addPrivacyRetentionException"]["input"]) => Promise<ServiceCatalog["contacts.addPrivacyRetentionException"]["output"]>;
    canContact: (input: ServiceCatalog["contacts.canContact"]["input"]) => Promise<ServiceCatalog["contacts.canContact"]["output"]>;
    create: (input: ServiceCatalog["contacts.create"]["input"]) => Promise<ServiceCatalog["contacts.create"]["output"]>;
    createCustomField: (input: ServiceCatalog["contacts.createCustomField"]["input"]) => Promise<ServiceCatalog["contacts.createCustomField"]["output"]>;
    createDataRequest: (input: ServiceCatalog["contacts.createDataRequest"]["input"]) => Promise<ServiceCatalog["contacts.createDataRequest"]["output"]>;
    createOrganization: (input: ServiceCatalog["contacts.createOrganization"]["input"]) => Promise<ServiceCatalog["contacts.createOrganization"]["output"]>;
    createRelationship: (input: ServiceCatalog["contacts.createRelationship"]["input"]) => Promise<ServiceCatalog["contacts.createRelationship"]["output"]>;
    deleteOrganization: (input: ServiceCatalog["contacts.deleteOrganization"]["input"]) => Promise<ServiceCatalog["contacts.deleteOrganization"]["output"]>;
    deleteRelationship: (input: ServiceCatalog["contacts.deleteRelationship"]["input"]) => Promise<ServiceCatalog["contacts.deleteRelationship"]["output"]>;
    denyDataRequest: (input: ServiceCatalog["contacts.denyDataRequest"]["input"]) => Promise<ServiceCatalog["contacts.denyDataRequest"]["output"]>;
    dismissDuplicateCandidate: (input: ServiceCatalog["contacts.dismissDuplicateCandidate"]["input"]) => Promise<ServiceCatalog["contacts.dismissDuplicateCandidate"]["output"]>;
    downloadDataRequestArtifact: (input: ServiceCatalog["contacts.downloadDataRequestArtifact"]["input"]) => Promise<ServiceCatalog["contacts.downloadDataRequestArtifact"]["output"]>;
    fulfillDataRequest: (input: ServiceCatalog["contacts.fulfillDataRequest"]["input"]) => Promise<ServiceCatalog["contacts.fulfillDataRequest"]["output"]>;
    get: (input: ServiceCatalog["contacts.get"]["input"]) => Promise<ServiceCatalog["contacts.get"]["output"]>;
    getConsentPreferences: (input: ServiceCatalog["contacts.getConsentPreferences"]["input"]) => Promise<ServiceCatalog["contacts.getConsentPreferences"]["output"]>;
    getDataRequest: (input: ServiceCatalog["contacts.getDataRequest"]["input"]) => Promise<ServiceCatalog["contacts.getDataRequest"]["output"]>;
    getOrganization: (input: ServiceCatalog["contacts.getOrganization"]["input"]) => Promise<ServiceCatalog["contacts.getOrganization"]["output"]>;
    list: (input?: ServiceCatalog["contacts.list"]["input"]) => Promise<ServiceCatalog["contacts.list"]["output"]>;
    listCustomFields: (input?: ServiceCatalog["contacts.listCustomFields"]["input"]) => Promise<ServiceCatalog["contacts.listCustomFields"]["output"]>;
    listDataRequests: (input?: ServiceCatalog["contacts.listDataRequests"]["input"]) => Promise<ServiceCatalog["contacts.listDataRequests"]["output"]>;
    listDuplicateCandidates: (input?: ServiceCatalog["contacts.listDuplicateCandidates"]["input"]) => Promise<ServiceCatalog["contacts.listDuplicateCandidates"]["output"]>;
    listMergeOperations: (input?: ServiceCatalog["contacts.listMergeOperations"]["input"]) => Promise<ServiceCatalog["contacts.listMergeOperations"]["output"]>;
    listOrganizations: (input?: ServiceCatalog["contacts.listOrganizations"]["input"]) => Promise<ServiceCatalog["contacts.listOrganizations"]["output"]>;
    listRelationships: (input: ServiceCatalog["contacts.listRelationships"]["input"]) => Promise<ServiceCatalog["contacts.listRelationships"]["output"]>;
    listTags: (input?: ServiceCatalog["contacts.listTags"]["input"]) => Promise<ServiceCatalog["contacts.listTags"]["output"]>;
    merge: (input: ServiceCatalog["contacts.merge"]["input"]) => Promise<ServiceCatalog["contacts.merge"]["output"]>;
    mergeDuplicateCandidate: (input: ServiceCatalog["contacts.mergeDuplicateCandidate"]["input"]) => Promise<ServiceCatalog["contacts.mergeDuplicateCandidate"]["output"]>;
    recordConsent: (input: ServiceCatalog["contacts.recordConsent"]["input"]) => Promise<ServiceCatalog["contacts.recordConsent"]["output"]>;
    removePrivacyRetentionException: (input: ServiceCatalog["contacts.removePrivacyRetentionException"]["input"]) => Promise<ServiceCatalog["contacts.removePrivacyRetentionException"]["output"]>;
    resolve: (input: ServiceCatalog["contacts.resolve"]["input"]) => Promise<ServiceCatalog["contacts.resolve"]["output"]>;
    scanDuplicates: (input?: ServiceCatalog["contacts.scanDuplicates"]["input"]) => Promise<ServiceCatalog["contacts.scanDuplicates"]["output"]>;
    startDataRequest: (input: ServiceCatalog["contacts.startDataRequest"]["input"]) => Promise<ServiceCatalog["contacts.startDataRequest"]["output"]>;
    stats: (input?: ServiceCatalog["contacts.stats"]["input"]) => Promise<ServiceCatalog["contacts.stats"]["output"]>;
    timeline: (input: ServiceCatalog["contacts.timeline"]["input"]) => Promise<ServiceCatalog["contacts.timeline"]["output"]>;
    undoMerge: (input: ServiceCatalog["contacts.undoMerge"]["input"]) => Promise<ServiceCatalog["contacts.undoMerge"]["output"]>;
    update: (input: ServiceCatalog["contacts.update"]["input"]) => Promise<ServiceCatalog["contacts.update"]["output"]>;
    updateCustomField: (input: ServiceCatalog["contacts.updateCustomField"]["input"]) => Promise<ServiceCatalog["contacts.updateCustomField"]["output"]>;
    updateOrganization: (input: ServiceCatalog["contacts.updateOrganization"]["input"]) => Promise<ServiceCatalog["contacts.updateOrganization"]["output"]>;
    updateRelationship: (input: ServiceCatalog["contacts.updateRelationship"]["input"]) => Promise<ServiceCatalog["contacts.updateRelationship"]["output"]>;
    verifyDataRequest: (input: ServiceCatalog["contacts.verifyDataRequest"]["input"]) => Promise<ServiceCatalog["contacts.verifyDataRequest"]["output"]>;
  };
  contracts: {
    archiveTemplate: (input: ServiceCatalog["contracts.archiveTemplate"]["input"]) => Promise<ServiceCatalog["contracts.archiveTemplate"]["output"]>;
    byToken: (input: ServiceCatalog["contracts.byToken"]["input"]) => Promise<ServiceCatalog["contracts.byToken"]["output"]>;
    countersign: (input: ServiceCatalog["contracts.countersign"]["input"]) => Promise<ServiceCatalog["contracts.countersign"]["output"]>;
    decline: (input: ServiceCatalog["contracts.decline"]["input"]) => Promise<ServiceCatalog["contracts.decline"]["output"]>;
    export: (input: ServiceCatalog["contracts.export"]["input"]) => Promise<ServiceCatalog["contracts.export"]["output"]>;
    get: (input: ServiceCatalog["contracts.get"]["input"]) => Promise<ServiceCatalog["contracts.get"]["output"]>;
    issue: (input: ServiceCatalog["contracts.issue"]["input"]) => Promise<ServiceCatalog["contracts.issue"]["output"]>;
    issueFromTemplate: (input: ServiceCatalog["contracts.issueFromTemplate"]["input"]) => Promise<ServiceCatalog["contracts.issueFromTemplate"]["output"]>;
    list: (input?: ServiceCatalog["contracts.list"]["input"]) => Promise<ServiceCatalog["contracts.list"]["output"]>;
    listTemplates: (input?: ServiceCatalog["contracts.listTemplates"]["input"]) => Promise<ServiceCatalog["contracts.listTemplates"]["output"]>;
    previewTemplate: (input: ServiceCatalog["contracts.previewTemplate"]["input"]) => Promise<ServiceCatalog["contracts.previewTemplate"]["output"]>;
    saveTemplate: (input: ServiceCatalog["contracts.saveTemplate"]["input"]) => Promise<ServiceCatalog["contracts.saveTemplate"]["output"]>;
    sign: (input: ServiceCatalog["contracts.sign"]["input"]) => Promise<ServiceCatalog["contracts.sign"]["output"]>;
    signedFor: (input: ServiceCatalog["contracts.signedFor"]["input"]) => Promise<ServiceCatalog["contracts.signedFor"]["output"]>;
    signingLink: (input: ServiceCatalog["contracts.signingLink"]["input"]) => Promise<ServiceCatalog["contracts.signingLink"]["output"]>;
    void: (input: ServiceCatalog["contracts.void"]["input"]) => Promise<ServiceCatalog["contracts.void"]["output"]>;
  };
  contribute: {
    attach: (input: ServiceCatalog["contribute.attach"]["input"]) => Promise<ServiceCatalog["contribute.attach"]["output"]>;
    determine: (input: ServiceCatalog["contribute.determine"]["input"]) => Promise<ServiceCatalog["contribute.determine"]["output"]>;
    draft: (input: ServiceCatalog["contribute.draft"]["input"]) => Promise<ServiceCatalog["contribute.draft"]["output"]>;
    get: (input: ServiceCatalog["contribute.get"]["input"]) => Promise<ServiceCatalog["contribute.get"]["output"]>;
    getSettings: (input?: ServiceCatalog["contribute.getSettings"]["input"]) => Promise<ServiceCatalog["contribute.getSettings"]["output"]>;
    hubStatus: (input?: ServiceCatalog["contribute.hubStatus"]["input"]) => Promise<ServiceCatalog["contribute.hubStatus"]["output"]>;
    ingest: (input: ServiceCatalog["contribute.ingest"]["input"]) => Promise<ServiceCatalog["contribute.ingest"]["output"]>;
    list: (input?: ServiceCatalog["contribute.list"]["input"]) => Promise<ServiceCatalog["contribute.list"]["output"]>;
    recordStatus: (input: ServiceCatalog["contribute.recordStatus"]["input"]) => Promise<ServiceCatalog["contribute.recordStatus"]["output"]>;
    setHubEnabled: (input: ServiceCatalog["contribute.setHubEnabled"]["input"]) => Promise<ServiceCatalog["contribute.setHubEnabled"]["output"]>;
    submit: (input: ServiceCatalog["contribute.submit"]["input"]) => Promise<ServiceCatalog["contribute.submit"]["output"]>;
    triage: (input: ServiceCatalog["contribute.triage"]["input"]) => Promise<ServiceCatalog["contribute.triage"]["output"]>;
    updateSettings: (input?: ServiceCatalog["contribute.updateSettings"]["input"]) => Promise<ServiceCatalog["contribute.updateSettings"]["output"]>;
  };
  conversations: {
    assign: (input: ServiceCatalog["conversations.assign"]["input"]) => Promise<ServiceCatalog["conversations.assign"]["output"]>;
    bulk: (input: ServiceCatalog["conversations.bulk"]["input"]) => Promise<ServiceCatalog["conversations.bulk"]["output"]>;
    counts: (input?: ServiceCatalog["conversations.counts"]["input"]) => Promise<ServiceCatalog["conversations.counts"]["output"]>;
    get: (input: ServiceCatalog["conversations.get"]["input"]) => Promise<ServiceCatalog["conversations.get"]["output"]>;
    list: (input?: ServiceCatalog["conversations.list"]["input"]) => Promise<ServiceCatalog["conversations.list"]["output"]>;
    markRead: (input: ServiceCatalog["conversations.markRead"]["input"]) => Promise<ServiceCatalog["conversations.markRead"]["output"]>;
    record: (input: ServiceCatalog["conversations.record"]["input"]) => Promise<ServiceCatalog["conversations.record"]["output"]>;
    recordDelivery: (input: ServiceCatalog["conversations.recordDelivery"]["input"]) => Promise<ServiceCatalog["conversations.recordDelivery"]["output"]>;
    reply: (input: ServiceCatalog["conversations.reply"]["input"]) => Promise<ServiceCatalog["conversations.reply"]["output"]>;
    search: (input?: ServiceCatalog["conversations.search"]["input"]) => Promise<ServiceCatalog["conversations.search"]["output"]>;
    setStatus: (input: ServiceCatalog["conversations.setStatus"]["input"]) => Promise<ServiceCatalog["conversations.setStatus"]["output"]>;
    snooze: (input: ServiceCatalog["conversations.snooze"]["input"]) => Promise<ServiceCatalog["conversations.snooze"]["output"]>;
  };
  core: {
    loadDemoBookings: (input: ServiceCatalog["core.loadDemoBookings"]["input"]) => Promise<ServiceCatalog["core.loadDemoBookings"]["output"]>;
    loadDemoContacts: (input: ServiceCatalog["core.loadDemoContacts"]["input"]) => Promise<ServiceCatalog["core.loadDemoContacts"]["output"]>;
    loadDemoInbox: (input: ServiceCatalog["core.loadDemoInbox"]["input"]) => Promise<ServiceCatalog["core.loadDemoInbox"]["output"]>;
    loadDemoLocations: (input: ServiceCatalog["core.loadDemoLocations"]["input"]) => Promise<ServiceCatalog["core.loadDemoLocations"]["output"]>;
    purgeDemoBookings: (input: ServiceCatalog["core.purgeDemoBookings"]["input"]) => Promise<ServiceCatalog["core.purgeDemoBookings"]["output"]>;
    purgeDemoContacts: (input: ServiceCatalog["core.purgeDemoContacts"]["input"]) => Promise<ServiceCatalog["core.purgeDemoContacts"]["output"]>;
    purgeDemoInbox: (input: ServiceCatalog["core.purgeDemoInbox"]["input"]) => Promise<ServiceCatalog["core.purgeDemoInbox"]["output"]>;
    purgeDemoLocations: (input: ServiceCatalog["core.purgeDemoLocations"]["input"]) => Promise<ServiceCatalog["core.purgeDemoLocations"]["output"]>;
    verifyDemoBookings: (input: ServiceCatalog["core.verifyDemoBookings"]["input"]) => Promise<ServiceCatalog["core.verifyDemoBookings"]["output"]>;
    verifyDemoContacts: (input: ServiceCatalog["core.verifyDemoContacts"]["input"]) => Promise<ServiceCatalog["core.verifyDemoContacts"]["output"]>;
    verifyDemoInbox: (input: ServiceCatalog["core.verifyDemoInbox"]["input"]) => Promise<ServiceCatalog["core.verifyDemoInbox"]["output"]>;
    verifyDemoLocations: (input: ServiceCatalog["core.verifyDemoLocations"]["input"]) => Promise<ServiceCatalog["core.verifyDemoLocations"]["output"]>;
  };
  crm: {
    createDeal: (input: ServiceCatalog["crm.createDeal"]["input"]) => Promise<ServiceCatalog["crm.createDeal"]["output"]>;
    installDefaults: (input?: ServiceCatalog["crm.installDefaults"]["input"]) => Promise<ServiceCatalog["crm.installDefaults"]["output"]>;
    lifecycleBoard: (input?: ServiceCatalog["crm.lifecycleBoard"]["input"]) => Promise<ServiceCatalog["crm.lifecycleBoard"]["output"]>;
    listDeals: (input?: ServiceCatalog["crm.listDeals"]["input"]) => Promise<ServiceCatalog["crm.listDeals"]["output"]>;
    listPipelines: (input?: ServiceCatalog["crm.listPipelines"]["input"]) => Promise<ServiceCatalog["crm.listPipelines"]["output"]>;
    moveContactStage: (input: ServiceCatalog["crm.moveContactStage"]["input"]) => Promise<ServiceCatalog["crm.moveContactStage"]["output"]>;
    moveDeal: (input: ServiceCatalog["crm.moveDeal"]["input"]) => Promise<ServiceCatalog["crm.moveDeal"]["output"]>;
    removeStage: (input: ServiceCatalog["crm.removeStage"]["input"]) => Promise<ServiceCatalog["crm.removeStage"]["output"]>;
    savePipeline: (input: ServiceCatalog["crm.savePipeline"]["input"]) => Promise<ServiceCatalog["crm.savePipeline"]["output"]>;
    saveStage: (input: ServiceCatalog["crm.saveStage"]["input"]) => Promise<ServiceCatalog["crm.saveStage"]["output"]>;
    updateDeal: (input: ServiceCatalog["crm.updateDeal"]["input"]) => Promise<ServiceCatalog["crm.updateDeal"]["output"]>;
  };
  demo: {
    install: (input?: ServiceCatalog["demo.install"]["input"]) => Promise<ServiceCatalog["demo.install"]["output"]>;
    list: (input?: ServiceCatalog["demo.list"]["input"]) => Promise<ServiceCatalog["demo.list"]["output"]>;
    load: (input: ServiceCatalog["demo.load"]["input"]) => Promise<ServiceCatalog["demo.load"]["output"]>;
    purge: (input?: ServiceCatalog["demo.purge"]["input"]) => Promise<ServiceCatalog["demo.purge"]["output"]>;
    reload: (input?: ServiceCatalog["demo.reload"]["input"]) => Promise<ServiceCatalog["demo.reload"]["output"]>;
    reset: (input: ServiceCatalog["demo.reset"]["input"]) => Promise<ServiceCatalog["demo.reset"]["output"]>;
  };
  documents: {
    addVersion: (input: ServiceCatalog["documents.addVersion"]["input"]) => Promise<ServiceCatalog["documents.addVersion"]["output"]>;
    export: (input: ServiceCatalog["documents.export"]["input"]) => Promise<ServiceCatalog["documents.export"]["output"]>;
    history: (input: ServiceCatalog["documents.history"]["input"]) => Promise<ServiceCatalog["documents.history"]["output"]>;
    list: (input?: ServiceCatalog["documents.list"]["input"]) => Promise<ServiceCatalog["documents.list"]["output"]>;
    open: (input: ServiceCatalog["documents.open"]["input"]) => Promise<ServiceCatalog["documents.open"]["output"]>;
    revokeShare: (input: ServiceCatalog["documents.revokeShare"]["input"]) => Promise<ServiceCatalog["documents.revokeShare"]["output"]>;
    save: (input: ServiceCatalog["documents.save"]["input"]) => Promise<ServiceCatalog["documents.save"]["output"]>;
    share: (input: ServiceCatalog["documents.share"]["input"]) => Promise<ServiceCatalog["documents.share"]["output"]>;
    shares: (input: ServiceCatalog["documents.shares"]["input"]) => Promise<ServiceCatalog["documents.shares"]["output"]>;
    versions: (input: ServiceCatalog["documents.versions"]["input"]) => Promise<ServiceCatalog["documents.versions"]["output"]>;
  };
  entitlements: {
    grant: (input: ServiceCatalog["entitlements.grant"]["input"]) => Promise<ServiceCatalog["entitlements.grant"]["output"]>;
    hasAccess: (input: ServiceCatalog["entitlements.hasAccess"]["input"]) => Promise<ServiceCatalog["entitlements.hasAccess"]["output"]>;
    list: (input?: ServiceCatalog["entitlements.list"]["input"]) => Promise<ServiceCatalog["entitlements.list"]["output"]>;
    listGrants: (input?: ServiceCatalog["entitlements.listGrants"]["input"]) => Promise<ServiceCatalog["entitlements.listGrants"]["output"]>;
    revoke: (input: ServiceCatalog["entitlements.revoke"]["input"]) => Promise<ServiceCatalog["entitlements.revoke"]["output"]>;
    save: (input: ServiceCatalog["entitlements.save"]["input"]) => Promise<ServiceCatalog["entitlements.save"]["output"]>;
    spendPass: (input: ServiceCatalog["entitlements.spendPass"]["input"]) => Promise<ServiceCatalog["entitlements.spendPass"]["output"]>;
  };
  events: {
    addSession: (input: ServiceCatalog["events.addSession"]["input"]) => Promise<ServiceCatalog["events.addSession"]["output"]>;
    addTicket: (input: ServiceCatalog["events.addTicket"]["input"]) => Promise<ServiceCatalog["events.addTicket"]["output"]>;
    calendar: (input: ServiceCatalog["events.calendar"]["input"]) => Promise<ServiceCatalog["events.calendar"]["output"]>;
    cancel: (input: ServiceCatalog["events.cancel"]["input"]) => Promise<ServiceCatalog["events.cancel"]["output"]>;
    cancelRegistration: (input: ServiceCatalog["events.cancelRegistration"]["input"]) => Promise<ServiceCatalog["events.cancelRegistration"]["output"]>;
    checkIn: (input: ServiceCatalog["events.checkIn"]["input"]) => Promise<ServiceCatalog["events.checkIn"]["output"]>;
    create: (input: ServiceCatalog["events.create"]["input"]) => Promise<ServiceCatalog["events.create"]["output"]>;
    get: (input: ServiceCatalog["events.get"]["input"]) => Promise<ServiceCatalog["events.get"]["output"]>;
    list: (input?: ServiceCatalog["events.list"]["input"]) => Promise<ServiceCatalog["events.list"]["output"]>;
    listPublic: (input?: ServiceCatalog["events.listPublic"]["input"]) => Promise<ServiceCatalog["events.listPublic"]["output"]>;
    publish: (input: ServiceCatalog["events.publish"]["input"]) => Promise<ServiceCatalog["events.publish"]["output"]>;
    recentActivity: (input?: ServiceCatalog["events.recentActivity"]["input"]) => Promise<ServiceCatalog["events.recentActivity"]["output"]>;
    register: (input: ServiceCatalog["events.register"]["input"]) => Promise<ServiceCatalog["events.register"]["output"]>;
    resolvePublic: (input: ServiceCatalog["events.resolvePublic"]["input"]) => Promise<ServiceCatalog["events.resolvePublic"]["output"]>;
    update: (input: ServiceCatalog["events.update"]["input"]) => Promise<ServiceCatalog["events.update"]["output"]>;
  };
  forms: {
    byId: (input: ServiceCatalog["forms.byId"]["input"]) => Promise<ServiceCatalog["forms.byId"]["output"]>;
    create: (input: ServiceCatalog["forms.create"]["input"]) => Promise<ServiceCatalog["forms.create"]["output"]>;
    delete: (input: ServiceCatalog["forms.delete"]["input"]) => Promise<ServiceCatalog["forms.delete"]["output"]>;
    get: (input: ServiceCatalog["forms.get"]["input"]) => Promise<ServiceCatalog["forms.get"]["output"]>;
    list: (input?: ServiceCatalog["forms.list"]["input"]) => Promise<ServiceCatalog["forms.list"]["output"]>;
    listSubmissions: (input: ServiceCatalog["forms.listSubmissions"]["input"]) => Promise<ServiceCatalog["forms.listSubmissions"]["output"]>;
    loadDemoFixture: (input: ServiceCatalog["forms.loadDemoFixture"]["input"]) => Promise<ServiceCatalog["forms.loadDemoFixture"]["output"]>;
    purgeDemoFixture: (input: ServiceCatalog["forms.purgeDemoFixture"]["input"]) => Promise<ServiceCatalog["forms.purgeDemoFixture"]["output"]>;
    reviewSubmission: (input: ServiceCatalog["forms.reviewSubmission"]["input"]) => Promise<ServiceCatalog["forms.reviewSubmission"]["output"]>;
    submissionCounts: (input?: ServiceCatalog["forms.submissionCounts"]["input"]) => Promise<ServiceCatalog["forms.submissionCounts"]["output"]>;
    submit: (input: ServiceCatalog["forms.submit"]["input"]) => Promise<ServiceCatalog["forms.submit"]["output"]>;
    update: (input: ServiceCatalog["forms.update"]["input"]) => Promise<ServiceCatalog["forms.update"]["output"]>;
    verifyDemoFixture: (input: ServiceCatalog["forms.verifyDemoFixture"]["input"]) => Promise<ServiceCatalog["forms.verifyDemoFixture"]["output"]>;
  };
  galleries: {
    addItem: (input: ServiceCatalog["galleries.addItem"]["input"]) => Promise<ServiceCatalog["galleries.addItem"]["output"]>;
    addPriceSheetItem: (input: ServiceCatalog["galleries.addPriceSheetItem"]["input"]) => Promise<ServiceCatalog["galleries.addPriceSheetItem"]["output"]>;
    addToCart: (input: ServiceCatalog["galleries.addToCart"]["input"]) => Promise<ServiceCatalog["galleries.addToCart"]["output"]>;
    approveRound: (input: ServiceCatalog["galleries.approveRound"]["input"]) => Promise<ServiceCatalog["galleries.approveRound"]["output"]>;
    archiveState: (input: ServiceCatalog["galleries.archiveState"]["input"]) => Promise<ServiceCatalog["galleries.archiveState"]["output"]>;
    clearSelection: (input: ServiceCatalog["galleries.clearSelection"]["input"]) => Promise<ServiceCatalog["galleries.clearSelection"]["output"]>;
    create: (input: ServiceCatalog["galleries.create"]["input"]) => Promise<ServiceCatalog["galleries.create"]["output"]>;
    downloadArchive: (input: ServiceCatalog["galleries.downloadArchive"]["input"]) => Promise<ServiceCatalog["galleries.downloadArchive"]["output"]>;
    downloadItem: (input: ServiceCatalog["galleries.downloadItem"]["input"]) => Promise<ServiceCatalog["galleries.downloadItem"]["output"]>;
    get: (input: ServiceCatalog["galleries.get"]["input"]) => Promise<ServiceCatalog["galleries.get"]["output"]>;
    inviteGuest: (input: ServiceCatalog["galleries.inviteGuest"]["input"]) => Promise<ServiceCatalog["galleries.inviteGuest"]["output"]>;
    invitePartner: (input: ServiceCatalog["galleries.invitePartner"]["input"]) => Promise<ServiceCatalog["galleries.invitePartner"]["output"]>;
    list: (input?: ServiceCatalog["galleries.list"]["input"]) => Promise<ServiceCatalog["galleries.list"]["output"]>;
    listAccess: (input: ServiceCatalog["galleries.listAccess"]["input"]) => Promise<ServiceCatalog["galleries.listAccess"]["output"]>;
    listGuests: (input: ServiceCatalog["galleries.listGuests"]["input"]) => Promise<ServiceCatalog["galleries.listGuests"]["output"]>;
    listPriceSheet: (input: ServiceCatalog["galleries.listPriceSheet"]["input"]) => Promise<ServiceCatalog["galleries.listPriceSheet"]["output"]>;
    listRounds: (input: ServiceCatalog["galleries.listRounds"]["input"]) => Promise<ServiceCatalog["galleries.listRounds"]["output"]>;
    listSelections: (input: ServiceCatalog["galleries.listSelections"]["input"]) => Promise<ServiceCatalog["galleries.listSelections"]["output"]>;
    loadDemoFixture: (input: ServiceCatalog["galleries.loadDemoFixture"]["input"]) => Promise<ServiceCatalog["galleries.loadDemoFixture"]["output"]>;
    openWithLogin: (input: ServiceCatalog["galleries.openWithLogin"]["input"]) => Promise<ServiceCatalog["galleries.openWithLogin"]["output"]>;
    publicBySlug: (input: ServiceCatalog["galleries.publicBySlug"]["input"]) => Promise<ServiceCatalog["galleries.publicBySlug"]["output"]>;
    purgeDemoFixture: (input: ServiceCatalog["galleries.purgeDemoFixture"]["input"]) => Promise<ServiceCatalog["galleries.purgeDemoFixture"]["output"]>;
    redeemGuest: (input: ServiceCatalog["galleries.redeemGuest"]["input"]) => Promise<ServiceCatalog["galleries.redeemGuest"]["output"]>;
    removeItem: (input: ServiceCatalog["galleries.removeItem"]["input"]) => Promise<ServiceCatalog["galleries.removeItem"]["output"]>;
    removePriceSheetItem: (input: ServiceCatalog["galleries.removePriceSheetItem"]["input"]) => Promise<ServiceCatalog["galleries.removePriceSheetItem"]["output"]>;
    reopenRound: (input: ServiceCatalog["galleries.reopenRound"]["input"]) => Promise<ServiceCatalog["galleries.reopenRound"]["output"]>;
    requestArchive: (input: ServiceCatalog["galleries.requestArchive"]["input"]) => Promise<ServiceCatalog["galleries.requestArchive"]["output"]>;
    revokeGuest: (input: ServiceCatalog["galleries.revokeGuest"]["input"]) => Promise<ServiceCatalog["galleries.revokeGuest"]["output"]>;
    revokePartner: (input: ServiceCatalog["galleries.revokePartner"]["input"]) => Promise<ServiceCatalog["galleries.revokePartner"]["output"]>;
    setSelection: (input: ServiceCatalog["galleries.setSelection"]["input"]) => Promise<ServiceCatalog["galleries.setSelection"]["output"]>;
    submitRound: (input: ServiceCatalog["galleries.submitRound"]["input"]) => Promise<ServiceCatalog["galleries.submitRound"]["output"]>;
    unlock: (input: ServiceCatalog["galleries.unlock"]["input"]) => Promise<ServiceCatalog["galleries.unlock"]["output"]>;
    update: (input: ServiceCatalog["galleries.update"]["input"]) => Promise<ServiceCatalog["galleries.update"]["output"]>;
    updateItem: (input: ServiceCatalog["galleries.updateItem"]["input"]) => Promise<ServiceCatalog["galleries.updateItem"]["output"]>;
    verifyDemoFixture: (input: ServiceCatalog["galleries.verifyDemoFixture"]["input"]) => Promise<ServiceCatalog["galleries.verifyDemoFixture"]["output"]>;
    viewItem: (input: ServiceCatalog["galleries.viewItem"]["input"]) => Promise<ServiceCatalog["galleries.viewItem"]["output"]>;
    viewSession: (input: ServiceCatalog["galleries.viewSession"]["input"]) => Promise<ServiceCatalog["galleries.viewSession"]["output"]>;
  };
  giftRegistry: {
    addItem: (input: ServiceCatalog["giftRegistry.addItem"]["input"]) => Promise<ServiceCatalog["giftRegistry.addItem"]["output"]>;
    contribute: (input: ServiceCatalog["giftRegistry.contribute"]["input"]) => Promise<ServiceCatalog["giftRegistry.contribute"]["output"]>;
    create: (input: ServiceCatalog["giftRegistry.create"]["input"]) => Promise<ServiceCatalog["giftRegistry.create"]["output"]>;
    getBySlug: (input: ServiceCatalog["giftRegistry.getBySlug"]["input"]) => Promise<ServiceCatalog["giftRegistry.getBySlug"]["output"]>;
    invoiceItem: (input: ServiceCatalog["giftRegistry.invoiceItem"]["input"]) => Promise<ServiceCatalog["giftRegistry.invoiceItem"]["output"]>;
    list: (input?: ServiceCatalog["giftRegistry.list"]["input"]) => Promise<ServiceCatalog["giftRegistry.list"]["output"]>;
    listItems: (input: ServiceCatalog["giftRegistry.listItems"]["input"]) => Promise<ServiceCatalog["giftRegistry.listItems"]["output"]>;
  };
  guidance: {
    contexts: (input?: ServiceCatalog["guidance.contexts"]["input"]) => Promise<ServiceCatalog["guidance.contexts"]["output"]>;
    dismiss: (input: ServiceCatalog["guidance.dismiss"]["input"]) => Promise<ServiceCatalog["guidance.dismiss"]["output"]>;
    list: (input?: ServiceCatalog["guidance.list"]["input"]) => Promise<ServiceCatalog["guidance.list"]["output"]>;
    reset: (input: ServiceCatalog["guidance.reset"]["input"]) => Promise<ServiceCatalog["guidance.reset"]["output"]>;
    start: (input: ServiceCatalog["guidance.start"]["input"]) => Promise<ServiceCatalog["guidance.start"]["output"]>;
  };
  i18n: {
    deleteTranslation: (input: ServiceCatalog["i18n.deleteTranslation"]["input"]) => Promise<ServiceCatalog["i18n.deleteTranslation"]["output"]>;
    getMyLocale: (input?: ServiceCatalog["i18n.getMyLocale"]["input"]) => Promise<ServiceCatalog["i18n.getMyLocale"]["output"]>;
    getTranslation: (input: ServiceCatalog["i18n.getTranslation"]["input"]) => Promise<ServiceCatalog["i18n.getTranslation"]["output"]>;
    listTranslations: (input: ServiceCatalog["i18n.listTranslations"]["input"]) => Promise<ServiceCatalog["i18n.listTranslations"]["output"]>;
    setMyLocale: (input: ServiceCatalog["i18n.setMyLocale"]["input"]) => Promise<ServiceCatalog["i18n.setMyLocale"]["output"]>;
    setTranslation: (input: ServiceCatalog["i18n.setTranslation"]["input"]) => Promise<ServiceCatalog["i18n.setTranslation"]["output"]>;
    translatedIds: (input: ServiceCatalog["i18n.translatedIds"]["input"]) => Promise<ServiceCatalog["i18n.translatedIds"]["output"]>;
    translationIndex: (input: ServiceCatalog["i18n.translationIndex"]["input"]) => Promise<ServiceCatalog["i18n.translationIndex"]["output"]>;
  };
  imports: {
    commit: (input: ServiceCatalog["imports.commit"]["input"]) => Promise<ServiceCatalog["imports.commit"]["output"]>;
    list: (input?: ServiceCatalog["imports.list"]["input"]) => Promise<ServiceCatalog["imports.list"]["output"]>;
    map: (input: ServiceCatalog["imports.map"]["input"]) => Promise<ServiceCatalog["imports.map"]["output"]>;
    preview: (input: ServiceCatalog["imports.preview"]["input"]) => Promise<ServiceCatalog["imports.preview"]["output"]>;
    previewFromSource: (input: ServiceCatalog["imports.previewFromSource"]["input"]) => Promise<ServiceCatalog["imports.previewFromSource"]["output"]>;
    publish: (input: ServiceCatalog["imports.publish"]["input"]) => Promise<ServiceCatalog["imports.publish"]["output"]>;
    reconcile: (input: ServiceCatalog["imports.reconcile"]["input"]) => Promise<ServiceCatalog["imports.reconcile"]["output"]>;
    reviewConflicts: (input: ServiceCatalog["imports.reviewConflicts"]["input"]) => Promise<ServiceCatalog["imports.reviewConflicts"]["output"]>;
    rollback: (input: ServiceCatalog["imports.rollback"]["input"]) => Promise<ServiceCatalog["imports.rollback"]["output"]>;
    start: (input: ServiceCatalog["imports.start"]["input"]) => Promise<ServiceCatalog["imports.start"]["output"]>;
  };
  invitations: {
    accept: (input: ServiceCatalog["invitations.accept"]["input"]) => Promise<ServiceCatalog["invitations.accept"]["output"]>;
    create: (input: ServiceCatalog["invitations.create"]["input"]) => Promise<ServiceCatalog["invitations.create"]["output"]>;
    inspect: (input: ServiceCatalog["invitations.inspect"]["input"]) => Promise<ServiceCatalog["invitations.inspect"]["output"]>;
    list: (input?: ServiceCatalog["invitations.list"]["input"]) => Promise<ServiceCatalog["invitations.list"]["output"]>;
    resend: (input: ServiceCatalog["invitations.resend"]["input"]) => Promise<ServiceCatalog["invitations.resend"]["output"]>;
    revoke: (input: ServiceCatalog["invitations.revoke"]["input"]) => Promise<ServiceCatalog["invitations.revoke"]["output"]>;
    roles: (input?: ServiceCatalog["invitations.roles"]["input"]) => Promise<ServiceCatalog["invitations.roles"]["output"]>;
  };
  invoicing: {
    addTaxRate: (input: ServiceCatalog["invoicing.addTaxRate"]["input"]) => Promise<ServiceCatalog["invoicing.addTaxRate"]["output"]>;
    adjustCustomerBalance: (input: ServiceCatalog["invoicing.adjustCustomerBalance"]["input"]) => Promise<ServiceCatalog["invoicing.adjustCustomerBalance"]["output"]>;
    applyCustomerBalance: (input: ServiceCatalog["invoicing.applyCustomerBalance"]["input"]) => Promise<ServiceCatalog["invoicing.applyCustomerBalance"]["output"]>;
    assessLateFee: (input: ServiceCatalog["invoicing.assessLateFee"]["input"]) => Promise<ServiceCatalog["invoicing.assessLateFee"]["output"]>;
    beginInPersonPayment: (input: ServiceCatalog["invoicing.beginInPersonPayment"]["input"]) => Promise<ServiceCatalog["invoicing.beginInPersonPayment"]["output"]>;
    beginPaymentCheckout: (input: ServiceCatalog["invoicing.beginPaymentCheckout"]["input"]) => Promise<ServiceCatalog["invoicing.beginPaymentCheckout"]["output"]>;
    cancelPayment: (input: ServiceCatalog["invoicing.cancelPayment"]["input"]) => Promise<ServiceCatalog["invoicing.cancelPayment"]["output"]>;
    cancelPaymentPlan: (input: ServiceCatalog["invoicing.cancelPaymentPlan"]["input"]) => Promise<ServiceCatalog["invoicing.cancelPaymentPlan"]["output"]>;
    cancelRefund: (input: ServiceCatalog["invoicing.cancelRefund"]["input"]) => Promise<ServiceCatalog["invoicing.cancelRefund"]["output"]>;
    completePaymentCheckout: (input: ServiceCatalog["invoicing.completePaymentCheckout"]["input"]) => Promise<ServiceCatalog["invoicing.completePaymentCheckout"]["output"]>;
    createCreditNote: (input: ServiceCatalog["invoicing.createCreditNote"]["input"]) => Promise<ServiceCatalog["invoicing.createCreditNote"]["output"]>;
    createDepositAndBalance: (input: ServiceCatalog["invoicing.createDepositAndBalance"]["input"]) => Promise<ServiceCatalog["invoicing.createDepositAndBalance"]["output"]>;
    createDraft: (input: ServiceCatalog["invoicing.createDraft"]["input"]) => Promise<ServiceCatalog["invoicing.createDraft"]["output"]>;
    createFlexiblePayment: (input: ServiceCatalog["invoicing.createFlexiblePayment"]["input"]) => Promise<ServiceCatalog["invoicing.createFlexiblePayment"]["output"]>;
    createPayment: (input: ServiceCatalog["invoicing.createPayment"]["input"]) => Promise<ServiceCatalog["invoicing.createPayment"]["output"]>;
    createPaymentPlan: (input: ServiceCatalog["invoicing.createPaymentPlan"]["input"]) => Promise<ServiceCatalog["invoicing.createPaymentPlan"]["output"]>;
    createRefund: (input: ServiceCatalog["invoicing.createRefund"]["input"]) => Promise<ServiceCatalog["invoicing.createRefund"]["output"]>;
    createSchedule: (input: ServiceCatalog["invoicing.createSchedule"]["input"]) => Promise<ServiceCatalog["invoicing.createSchedule"]["output"]>;
    createTaxCategory: (input: ServiceCatalog["invoicing.createTaxCategory"]["input"]) => Promise<ServiceCatalog["invoicing.createTaxCategory"]["output"]>;
    createTaxZone: (input: ServiceCatalog["invoicing.createTaxZone"]["input"]) => Promise<ServiceCatalog["invoicing.createTaxZone"]["output"]>;
    failPayment: (input: ServiceCatalog["invoicing.failPayment"]["input"]) => Promise<ServiceCatalog["invoicing.failPayment"]["output"]>;
    failRefund: (input: ServiceCatalog["invoicing.failRefund"]["input"]) => Promise<ServiceCatalog["invoicing.failRefund"]["output"]>;
    get: (input: ServiceCatalog["invoicing.get"]["input"]) => Promise<ServiceCatalog["invoicing.get"]["output"]>;
    getCustomerBalance: (input: ServiceCatalog["invoicing.getCustomerBalance"]["input"]) => Promise<ServiceCatalog["invoicing.getCustomerBalance"]["output"]>;
    getPayment: (input: ServiceCatalog["invoicing.getPayment"]["input"]) => Promise<ServiceCatalog["invoicing.getPayment"]["output"]>;
    getPaymentPlan: (input: ServiceCatalog["invoicing.getPaymentPlan"]["input"]) => Promise<ServiceCatalog["invoicing.getPaymentPlan"]["output"]>;
    installTaxTemplate: (input: ServiceCatalog["invoicing.installTaxTemplate"]["input"]) => Promise<ServiceCatalog["invoicing.installTaxTemplate"]["output"]>;
    issue: (input: ServiceCatalog["invoicing.issue"]["input"]) => Promise<ServiceCatalog["invoicing.issue"]["output"]>;
    issueCreditNote: (input: ServiceCatalog["invoicing.issueCreditNote"]["input"]) => Promise<ServiceCatalog["invoicing.issueCreditNote"]["output"]>;
    list: (input?: ServiceCatalog["invoicing.list"]["input"]) => Promise<ServiceCatalog["invoicing.list"]["output"]>;
    listInPersonPayments: (input?: ServiceCatalog["invoicing.listInPersonPayments"]["input"]) => Promise<ServiceCatalog["invoicing.listInPersonPayments"]["output"]>;
    listPaymentDisputes: (input?: ServiceCatalog["invoicing.listPaymentDisputes"]["input"]) => Promise<ServiceCatalog["invoicing.listPaymentDisputes"]["output"]>;
    listPaymentProviders: (input: ServiceCatalog["invoicing.listPaymentProviders"]["input"]) => Promise<ServiceCatalog["invoicing.listPaymentProviders"]["output"]>;
    listPayments: (input?: ServiceCatalog["invoicing.listPayments"]["input"]) => Promise<ServiceCatalog["invoicing.listPayments"]["output"]>;
    listPointOfSale: (input?: ServiceCatalog["invoicing.listPointOfSale"]["input"]) => Promise<ServiceCatalog["invoicing.listPointOfSale"]["output"]>;
    listProviderPayouts: (input?: ServiceCatalog["invoicing.listProviderPayouts"]["input"]) => Promise<ServiceCatalog["invoicing.listProviderPayouts"]["output"]>;
    listSavedPaymentMethods: (input?: ServiceCatalog["invoicing.listSavedPaymentMethods"]["input"]) => Promise<ServiceCatalog["invoicing.listSavedPaymentMethods"]["output"]>;
    listSchedules: (input?: ServiceCatalog["invoicing.listSchedules"]["input"]) => Promise<ServiceCatalog["invoicing.listSchedules"]["output"]>;
    listTaxTemplates: (input?: ServiceCatalog["invoicing.listTaxTemplates"]["input"]) => Promise<ServiceCatalog["invoicing.listTaxTemplates"]["output"]>;
    loadDemoFixture: (input: ServiceCatalog["invoicing.loadDemoFixture"]["input"]) => Promise<ServiceCatalog["invoicing.loadDemoFixture"]["output"]>;
    markOverdue: (input: ServiceCatalog["invoicing.markOverdue"]["input"]) => Promise<ServiceCatalog["invoicing.markOverdue"]["output"]>;
    markOverdueSweep: (input?: ServiceCatalog["invoicing.markOverdueSweep"]["input"]) => Promise<ServiceCatalog["invoicing.markOverdueSweep"]["output"]>;
    markViewed: (input: ServiceCatalog["invoicing.markViewed"]["input"]) => Promise<ServiceCatalog["invoicing.markViewed"]["output"]>;
    processPaymentProviderEvents: (input: ServiceCatalog["invoicing.processPaymentProviderEvents"]["input"]) => Promise<ServiceCatalog["invoicing.processPaymentProviderEvents"]["output"]>;
    purgeDemoFixture: (input: ServiceCatalog["invoicing.purgeDemoFixture"]["input"]) => Promise<ServiceCatalog["invoicing.purgeDemoFixture"]["output"]>;
    quoteTax: (input: ServiceCatalog["invoicing.quoteTax"]["input"]) => Promise<ServiceCatalog["invoicing.quoteTax"]["output"]>;
    receipt: (input: ServiceCatalog["invoicing.receipt"]["input"]) => Promise<ServiceCatalog["invoicing.receipt"]["output"]>;
    reconcileAdvancedMoney: (input?: ServiceCatalog["invoicing.reconcileAdvancedMoney"]["input"]) => Promise<ServiceCatalog["invoicing.reconcileAdvancedMoney"]["output"]>;
    reconcileInPersonPayments: (input?: ServiceCatalog["invoicing.reconcileInPersonPayments"]["input"]) => Promise<ServiceCatalog["invoicing.reconcileInPersonPayments"]["output"]>;
    reconcilePaymentProviders: (input?: ServiceCatalog["invoicing.reconcilePaymentProviders"]["input"]) => Promise<ServiceCatalog["invoicing.reconcilePaymentProviders"]["output"]>;
    reconcileProviderPayout: (input: ServiceCatalog["invoicing.reconcileProviderPayout"]["input"]) => Promise<ServiceCatalog["invoicing.reconcileProviderPayout"]["output"]>;
    reconciliation: (input?: ServiceCatalog["invoicing.reconciliation"]["input"]) => Promise<ServiceCatalog["invoicing.reconciliation"]["output"]>;
    recordOfflinePayment: (input: ServiceCatalog["invoicing.recordOfflinePayment"]["input"]) => Promise<ServiceCatalog["invoicing.recordOfflinePayment"]["output"]>;
    recordOfflineRefund: (input: ServiceCatalog["invoicing.recordOfflineRefund"]["input"]) => Promise<ServiceCatalog["invoicing.recordOfflineRefund"]["output"]>;
    recordProviderBalanceTransaction: (input: ServiceCatalog["invoicing.recordProviderBalanceTransaction"]["input"]) => Promise<ServiceCatalog["invoicing.recordProviderBalanceTransaction"]["output"]>;
    recordProviderPayout: (input: ServiceCatalog["invoicing.recordProviderPayout"]["input"]) => Promise<ServiceCatalog["invoicing.recordProviderPayout"]["output"]>;
    refreshPaymentPlans: (input?: ServiceCatalog["invoicing.refreshPaymentPlans"]["input"]) => Promise<ServiceCatalog["invoicing.refreshPaymentPlans"]["output"]>;
    refundCustomerBalancePayment: (input: ServiceCatalog["invoicing.refundCustomerBalancePayment"]["input"]) => Promise<ServiceCatalog["invoicing.refundCustomerBalancePayment"]["output"]>;
    refundInPersonPayment: (input: ServiceCatalog["invoicing.refundInPersonPayment"]["input"]) => Promise<ServiceCatalog["invoicing.refundInPersonPayment"]["output"]>;
    reminders: (input: ServiceCatalog["invoicing.reminders"]["input"]) => Promise<ServiceCatalog["invoicing.reminders"]["output"]>;
    revokeSavedPaymentMethod: (input: ServiceCatalog["invoicing.revokeSavedPaymentMethod"]["input"]) => Promise<ServiceCatalog["invoicing.revokeSavedPaymentMethod"]["output"]>;
    runSchedules: (input?: ServiceCatalog["invoicing.runSchedules"]["input"]) => Promise<ServiceCatalog["invoicing.runSchedules"]["output"]>;
    scheduleReminders: (input: ServiceCatalog["invoicing.scheduleReminders"]["input"]) => Promise<ServiceCatalog["invoicing.scheduleReminders"]["output"]>;
    setTaxExemption: (input: ServiceCatalog["invoicing.setTaxExemption"]["input"]) => Promise<ServiceCatalog["invoicing.setTaxExemption"]["output"]>;
    setTaxRegistration: (input: ServiceCatalog["invoicing.setTaxRegistration"]["input"]) => Promise<ServiceCatalog["invoicing.setTaxRegistration"]["output"]>;
    settlePayment: (input: ServiceCatalog["invoicing.settlePayment"]["input"]) => Promise<ServiceCatalog["invoicing.settlePayment"]["output"]>;
    settleRefund: (input: ServiceCatalog["invoicing.settleRefund"]["input"]) => Promise<ServiceCatalog["invoicing.settleRefund"]["output"]>;
    startPayment: (input: ServiceCatalog["invoicing.startPayment"]["input"]) => Promise<ServiceCatalog["invoicing.startPayment"]["output"]>;
    startRefund: (input: ServiceCatalog["invoicing.startRefund"]["input"]) => Promise<ServiceCatalog["invoicing.startRefund"]["output"]>;
    submitProviderRefund: (input: ServiceCatalog["invoicing.submitProviderRefund"]["input"]) => Promise<ServiceCatalog["invoicing.submitProviderRefund"]["output"]>;
    taxConfiguration: (input?: ServiceCatalog["invoicing.taxConfiguration"]["input"]) => Promise<ServiceCatalog["invoicing.taxConfiguration"]["output"]>;
    taxThresholds: (input?: ServiceCatalog["invoicing.taxThresholds"]["input"]) => Promise<ServiceCatalog["invoicing.taxThresholds"]["output"]>;
    updateSchedule: (input: ServiceCatalog["invoicing.updateSchedule"]["input"]) => Promise<ServiceCatalog["invoicing.updateSchedule"]["output"]>;
    verifyDemoFixture: (input: ServiceCatalog["invoicing.verifyDemoFixture"]["input"]) => Promise<ServiceCatalog["invoicing.verifyDemoFixture"]["output"]>;
    void: (input: ServiceCatalog["invoicing.void"]["input"]) => Promise<ServiceCatalog["invoicing.void"]["output"]>;
    voidCreditNote: (input: ServiceCatalog["invoicing.voidCreditNote"]["input"]) => Promise<ServiceCatalog["invoicing.voidCreditNote"]["output"]>;
  };
  locations: {
    create: (input: ServiceCatalog["locations.create"]["input"]) => Promise<ServiceCatalog["locations.create"]["output"]>;
    createSetupLocation: (input: ServiceCatalog["locations.createSetupLocation"]["input"]) => Promise<ServiceCatalog["locations.createSetupLocation"]["output"]>;
    get: (input?: ServiceCatalog["locations.get"]["input"]) => Promise<ServiceCatalog["locations.get"]["output"]>;
    list: (input?: ServiceCatalog["locations.list"]["input"]) => Promise<ServiceCatalog["locations.list"]["output"]>;
    primary: (input?: ServiceCatalog["locations.primary"]["input"]) => Promise<ServiceCatalog["locations.primary"]["output"]>;
    remove: (input: ServiceCatalog["locations.remove"]["input"]) => Promise<ServiceCatalog["locations.remove"]["output"]>;
    setHours: (input: ServiceCatalog["locations.setHours"]["input"]) => Promise<ServiceCatalog["locations.setHours"]["output"]>;
    setPrimary: (input: ServiceCatalog["locations.setPrimary"]["input"]) => Promise<ServiceCatalog["locations.setPrimary"]["output"]>;
    setServiceArea: (input: ServiceCatalog["locations.setServiceArea"]["input"]) => Promise<ServiceCatalog["locations.setServiceArea"]["output"]>;
    update: (input: ServiceCatalog["locations.update"]["input"]) => Promise<ServiceCatalog["locations.update"]["output"]>;
  };
  loyalty: {
    adjustPoints: (input: ServiceCatalog["loyalty.adjustPoints"]["input"]) => Promise<ServiceCatalog["loyalty.adjustPoints"]["output"]>;
    earnRules: (input: ServiceCatalog["loyalty.earnRules"]["input"]) => Promise<ServiceCatalog["loyalty.earnRules"]["output"]>;
    earnableEvents: (input?: ServiceCatalog["loyalty.earnableEvents"]["input"]) => Promise<ServiceCatalog["loyalty.earnableEvents"]["output"]>;
    enrol: (input: ServiceCatalog["loyalty.enrol"]["input"]) => Promise<ServiceCatalog["loyalty.enrol"]["output"]>;
    liability: (input: ServiceCatalog["loyalty.liability"]["input"]) => Promise<ServiceCatalog["loyalty.liability"]["output"]>;
    myStatement: (input: ServiceCatalog["loyalty.myStatement"]["input"]) => Promise<ServiceCatalog["loyalty.myStatement"]["output"]>;
    programs: (input?: ServiceCatalog["loyalty.programs"]["input"]) => Promise<ServiceCatalog["loyalty.programs"]["output"]>;
    redeem: (input: ServiceCatalog["loyalty.redeem"]["input"]) => Promise<ServiceCatalog["loyalty.redeem"]["output"]>;
    redemptions: (input: ServiceCatalog["loyalty.redemptions"]["input"]) => Promise<ServiceCatalog["loyalty.redemptions"]["output"]>;
    reevaluateTier: (input: ServiceCatalog["loyalty.reevaluateTier"]["input"]) => Promise<ServiceCatalog["loyalty.reevaluateTier"]["output"]>;
    rewards: (input: ServiceCatalog["loyalty.rewards"]["input"]) => Promise<ServiceCatalog["loyalty.rewards"]["output"]>;
    saveEarnRule: (input: ServiceCatalog["loyalty.saveEarnRule"]["input"]) => Promise<ServiceCatalog["loyalty.saveEarnRule"]["output"]>;
    saveProgram: (input: ServiceCatalog["loyalty.saveProgram"]["input"]) => Promise<ServiceCatalog["loyalty.saveProgram"]["output"]>;
    saveReward: (input: ServiceCatalog["loyalty.saveReward"]["input"]) => Promise<ServiceCatalog["loyalty.saveReward"]["output"]>;
    saveTier: (input: ServiceCatalog["loyalty.saveTier"]["input"]) => Promise<ServiceCatalog["loyalty.saveTier"]["output"]>;
    statement: (input: ServiceCatalog["loyalty.statement"]["input"]) => Promise<ServiceCatalog["loyalty.statement"]["output"]>;
    tiers: (input: ServiceCatalog["loyalty.tiers"]["input"]) => Promise<ServiceCatalog["loyalty.tiers"]["output"]>;
  };
  mail: {
    beginOAuth: (input: ServiceCatalog["mail.beginOAuth"]["input"]) => Promise<ServiceCatalog["mail.beginOAuth"]["output"]>;
    completeOAuth: (input: ServiceCatalog["mail.completeOAuth"]["input"]) => Promise<ServiceCatalog["mail.completeOAuth"]["output"]>;
    registerSender: (input: ServiceCatalog["mail.registerSender"]["input"]) => Promise<ServiceCatalog["mail.registerSender"]["output"]>;
    releaseSuppression: (input: ServiceCatalog["mail.releaseSuppression"]["input"]) => Promise<ServiceCatalog["mail.releaseSuppression"]["output"]>;
    setDefaultSender: (input: ServiceCatalog["mail.setDefaultSender"]["input"]) => Promise<ServiceCatalog["mail.setDefaultSender"]["output"]>;
    status: (input?: ServiceCatalog["mail.status"]["input"]) => Promise<ServiceCatalog["mail.status"]["output"]>;
    testSend: (input: ServiceCatalog["mail.testSend"]["input"]) => Promise<ServiceCatalog["mail.testSend"]["output"]>;
    updateSender: (input: ServiceCatalog["mail.updateSender"]["input"]) => Promise<ServiceCatalog["mail.updateSender"]["output"]>;
    verifySender: (input: ServiceCatalog["mail.verifySender"]["input"]) => Promise<ServiceCatalog["mail.verifySender"]["output"]>;
  };
  marketplace: {
    connect: (input: ServiceCatalog["marketplace.connect"]["input"]) => Promise<ServiceCatalog["marketplace.connect"]["output"]>;
    list: (input?: ServiceCatalog["marketplace.list"]["input"]) => Promise<ServiceCatalog["marketplace.list"]["output"]>;
    sync: (input: ServiceCatalog["marketplace.sync"]["input"]) => Promise<ServiceCatalog["marketplace.sync"]["output"]>;
  };
  media: {
    abortUpload: (input: ServiceCatalog["media.abortUpload"]["input"]) => Promise<ServiceCatalog["media.abortUpload"]["output"]>;
    acceptAltTextSuggestion: (input: ServiceCatalog["media.acceptAltTextSuggestion"]["input"]) => Promise<ServiceCatalog["media.acceptAltTextSuggestion"]["output"]>;
    altTextSuggestionState: (input: ServiceCatalog["media.altTextSuggestionState"]["input"]) => Promise<ServiceCatalog["media.altTextSuggestionState"]["output"]>;
    appendCaptureChunk: (input: ServiceCatalog["media.appendCaptureChunk"]["input"]) => Promise<ServiceCatalog["media.appendCaptureChunk"]["output"]>;
    assembleCapture: (input?: ServiceCatalog["media.assembleCapture"]["input"]) => Promise<ServiceCatalog["media.assembleCapture"]["output"]>;
    attachCaptureUpload: (input: ServiceCatalog["media.attachCaptureUpload"]["input"]) => Promise<ServiceCatalog["media.attachCaptureUpload"]["output"]>;
    authorizeAssetDownload: (input: ServiceCatalog["media.authorizeAssetDownload"]["input"]) => Promise<ServiceCatalog["media.authorizeAssetDownload"]["output"]>;
    authorizeObjectDelivery: (input: ServiceCatalog["media.authorizeObjectDelivery"]["input"]) => Promise<ServiceCatalog["media.authorizeObjectDelivery"]["output"]>;
    beginUpload: (input: ServiceCatalog["media.beginUpload"]["input"]) => Promise<ServiceCatalog["media.beginUpload"]["output"]>;
    bindCaptureAsset: (input: ServiceCatalog["media.bindCaptureAsset"]["input"]) => Promise<ServiceCatalog["media.bindCaptureAsset"]["output"]>;
    completeUpload: (input: ServiceCatalog["media.completeUpload"]["input"]) => Promise<ServiceCatalog["media.completeUpload"]["output"]>;
    confirmCapture: (input?: ServiceCatalog["media.confirmCapture"]["input"]) => Promise<ServiceCatalog["media.confirmCapture"]["output"]>;
    createCaptureSession: (input: ServiceCatalog["media.createCaptureSession"]["input"]) => Promise<ServiceCatalog["media.createCaptureSession"]["output"]>;
    createUploadLink: (input?: ServiceCatalog["media.createUploadLink"]["input"]) => Promise<ServiceCatalog["media.createUploadLink"]["output"]>;
    discardCapture: (input: ServiceCatalog["media.discardCapture"]["input"]) => Promise<ServiceCatalog["media.discardCapture"]["output"]>;
    dismissAltTextSuggestion: (input: ServiceCatalog["media.dismissAltTextSuggestion"]["input"]) => Promise<ServiceCatalog["media.dismissAltTextSuggestion"]["output"]>;
    expireCaptureSessions: (input?: ServiceCatalog["media.expireCaptureSessions"]["input"]) => Promise<ServiceCatalog["media.expireCaptureSessions"]["output"]>;
    generateAltTextSuggestion: (input: ServiceCatalog["media.generateAltTextSuggestion"]["input"]) => Promise<ServiceCatalog["media.generateAltTextSuggestion"]["output"]>;
    get: (input: ServiceCatalog["media.get"]["input"]) => Promise<ServiceCatalog["media.get"]["output"]>;
    getCaptureSession: (input?: ServiceCatalog["media.getCaptureSession"]["input"]) => Promise<ServiceCatalog["media.getCaptureSession"]["output"]>;
    grantCapturePermission: (input: ServiceCatalog["media.grantCapturePermission"]["input"]) => Promise<ServiceCatalog["media.grantCapturePermission"]["output"]>;
    list: (input?: ServiceCatalog["media.list"]["input"]) => Promise<ServiceCatalog["media.list"]["output"]>;
    listAltTextSuggestionStates: (input: ServiceCatalog["media.listAltTextSuggestionStates"]["input"]) => Promise<ServiceCatalog["media.listAltTextSuggestionStates"]["output"]>;
    listCaptureSessions: (input?: ServiceCatalog["media.listCaptureSessions"]["input"]) => Promise<ServiceCatalog["media.listCaptureSessions"]["output"]>;
    purge: (input: ServiceCatalog["media.purge"]["input"]) => Promise<ServiceCatalog["media.purge"]["output"]>;
    rescan: (input: ServiceCatalog["media.rescan"]["input"]) => Promise<ServiceCatalog["media.rescan"]["output"]>;
    resolveAsset: (input: ServiceCatalog["media.resolveAsset"]["input"]) => Promise<ServiceCatalog["media.resolveAsset"]["output"]>;
    resolveImage: (input: ServiceCatalog["media.resolveImage"]["input"]) => Promise<ServiceCatalog["media.resolveImage"]["output"]>;
    restore: (input: ServiceCatalog["media.restore"]["input"]) => Promise<ServiceCatalog["media.restore"]["output"]>;
    reviewCapture: (input: ServiceCatalog["media.reviewCapture"]["input"]) => Promise<ServiceCatalog["media.reviewCapture"]["output"]>;
    setAltText: (input: ServiceCatalog["media.setAltText"]["input"]) => Promise<ServiceCatalog["media.setAltText"]["output"]>;
    setFocalPoint: (input: ServiceCatalog["media.setFocalPoint"]["input"]) => Promise<ServiceCatalog["media.setFocalPoint"]["output"]>;
    signUploadParts: (input: ServiceCatalog["media.signUploadParts"]["input"]) => Promise<ServiceCatalog["media.signUploadParts"]["output"]>;
    stageCompletedUpload: (input: ServiceCatalog["media.stageCompletedUpload"]["input"]) => Promise<ServiceCatalog["media.stageCompletedUpload"]["output"]>;
    startCapture: (input: ServiceCatalog["media.startCapture"]["input"]) => Promise<ServiceCatalog["media.startCapture"]["output"]>;
    stopCapture: (input: ServiceCatalog["media.stopCapture"]["input"]) => Promise<ServiceCatalog["media.stopCapture"]["output"]>;
    trash: (input: ServiceCatalog["media.trash"]["input"]) => Promise<ServiceCatalog["media.trash"]["output"]>;
    updateDetails: (input: ServiceCatalog["media.updateDetails"]["input"]) => Promise<ServiceCatalog["media.updateDetails"]["output"]>;
    upload: (input: ServiceCatalog["media.upload"]["input"]) => Promise<ServiceCatalog["media.upload"]["output"]>;
    uploadStatus: (input: ServiceCatalog["media.uploadStatus"]["input"]) => Promise<ServiceCatalog["media.uploadStatus"]["output"]>;
    usage: (input: ServiceCatalog["media.usage"]["input"]) => Promise<ServiceCatalog["media.usage"]["output"]>;
  };
  messaging: {
    checkNumbers: (input?: ServiceCatalog["messaging.checkNumbers"]["input"]) => Promise<ServiceCatalog["messaging.checkNumbers"]["output"]>;
    complianceEvents: (input?: ServiceCatalog["messaging.complianceEvents"]["input"]) => Promise<ServiceCatalog["messaging.complianceEvents"]["output"]>;
    createKeywordRule: (input: ServiceCatalog["messaging.createKeywordRule"]["input"]) => Promise<ServiceCatalog["messaging.createKeywordRule"]["output"]>;
    deleteKeywordRule: (input: ServiceCatalog["messaging.deleteKeywordRule"]["input"]) => Promise<ServiceCatalog["messaging.deleteKeywordRule"]["output"]>;
    endSiteChat: (input: ServiceCatalog["messaging.endSiteChat"]["input"]) => Promise<ServiceCatalog["messaging.endSiteChat"]["output"]>;
    escalateAssistantChat: (input: ServiceCatalog["messaging.escalateAssistantChat"]["input"]) => Promise<ServiceCatalog["messaging.escalateAssistantChat"]["output"]>;
    evaluateSmsPolicy: (input: ServiceCatalog["messaging.evaluateSmsPolicy"]["input"]) => Promise<ServiceCatalog["messaging.evaluateSmsPolicy"]["output"]>;
    getSiteChat: (input: ServiceCatalog["messaging.getSiteChat"]["input"]) => Promise<ServiceCatalog["messaging.getSiteChat"]["output"]>;
    importNumbers: (input?: ServiceCatalog["messaging.importNumbers"]["input"]) => Promise<ServiceCatalog["messaging.importNumbers"]["output"]>;
    keywordEvents: (input?: ServiceCatalog["messaging.keywordEvents"]["input"]) => Promise<ServiceCatalog["messaging.keywordEvents"]["output"]>;
    keywordRules: (input?: ServiceCatalog["messaging.keywordRules"]["input"]) => Promise<ServiceCatalog["messaging.keywordRules"]["output"]>;
    numbers: (input?: ServiceCatalog["messaging.numbers"]["input"]) => Promise<ServiceCatalog["messaging.numbers"]["output"]>;
    postSiteChat: (input: ServiceCatalog["messaging.postSiteChat"]["input"]) => Promise<ServiceCatalog["messaging.postSiteChat"]["output"]>;
    registrations: (input?: ServiceCatalog["messaging.registrations"]["input"]) => Promise<ServiceCatalog["messaging.registrations"]["output"]>;
    sendAssistantChatMessage: (input: ServiceCatalog["messaging.sendAssistantChatMessage"]["input"]) => Promise<ServiceCatalog["messaging.sendAssistantChatMessage"]["output"]>;
    sendSms: (input: ServiceCatalog["messaging.sendSms"]["input"]) => Promise<ServiceCatalog["messaging.sendSms"]["output"]>;
    setRegistration: (input: ServiceCatalog["messaging.setRegistration"]["input"]) => Promise<ServiceCatalog["messaging.setRegistration"]["output"]>;
    setWindow: (input: ServiceCatalog["messaging.setWindow"]["input"]) => Promise<ServiceCatalog["messaging.setWindow"]["output"]>;
    startSiteChat: (input: ServiceCatalog["messaging.startSiteChat"]["input"]) => Promise<ServiceCatalog["messaging.startSiteChat"]["output"]>;
    updateKeywordRule: (input: ServiceCatalog["messaging.updateKeywordRule"]["input"]) => Promise<ServiceCatalog["messaging.updateKeywordRule"]["output"]>;
    updateNumber: (input: ServiceCatalog["messaging.updateNumber"]["input"]) => Promise<ServiceCatalog["messaging.updateNumber"]["output"]>;
    windows: (input?: ServiceCatalog["messaging.windows"]["input"]) => Promise<ServiceCatalog["messaging.windows"]["output"]>;
  };
  newsletters: {
    confirm: (input: ServiceCatalog["newsletters.confirm"]["input"]) => Promise<ServiceCatalog["newsletters.confirm"]["output"]>;
    create: (input: ServiceCatalog["newsletters.create"]["input"]) => Promise<ServiceCatalog["newsletters.create"]["output"]>;
    createIssue: (input: ServiceCatalog["newsletters.createIssue"]["input"]) => Promise<ServiceCatalog["newsletters.createIssue"]["output"]>;
    get: (input: ServiceCatalog["newsletters.get"]["input"]) => Promise<ServiceCatalog["newsletters.get"]["output"]>;
    list: (input?: ServiceCatalog["newsletters.list"]["input"]) => Promise<ServiceCatalog["newsletters.list"]["output"]>;
    listPublic: (input?: ServiceCatalog["newsletters.listPublic"]["input"]) => Promise<ServiceCatalog["newsletters.listPublic"]["output"]>;
    listPublicIssues: (input?: ServiceCatalog["newsletters.listPublicIssues"]["input"]) => Promise<ServiceCatalog["newsletters.listPublicIssues"]["output"]>;
    publishIssue: (input: ServiceCatalog["newsletters.publishIssue"]["input"]) => Promise<ServiceCatalog["newsletters.publishIssue"]["output"]>;
    resolvePublicIssue: (input: ServiceCatalog["newsletters.resolvePublicIssue"]["input"]) => Promise<ServiceCatalog["newsletters.resolvePublicIssue"]["output"]>;
    subscribe: (input: ServiceCatalog["newsletters.subscribe"]["input"]) => Promise<ServiceCatalog["newsletters.subscribe"]["output"]>;
    unsubscribe: (input: ServiceCatalog["newsletters.unsubscribe"]["input"]) => Promise<ServiceCatalog["newsletters.unsubscribe"]["output"]>;
    update: (input: ServiceCatalog["newsletters.update"]["input"]) => Promise<ServiceCatalog["newsletters.update"]["output"]>;
    updateIssue: (input: ServiceCatalog["newsletters.updateIssue"]["input"]) => Promise<ServiceCatalog["newsletters.updateIssue"]["output"]>;
  };
  notes: {
    edit: (input: ServiceCatalog["notes.edit"]["input"]) => Promise<ServiceCatalog["notes.edit"]["output"]>;
    history: (input: ServiceCatalog["notes.history"]["input"]) => Promise<ServiceCatalog["notes.history"]["output"]>;
    list: (input?: ServiceCatalog["notes.list"]["input"]) => Promise<ServiceCatalog["notes.list"]["output"]>;
    pin: (input: ServiceCatalog["notes.pin"]["input"]) => Promise<ServiceCatalog["notes.pin"]["output"]>;
    remove: (input: ServiceCatalog["notes.remove"]["input"]) => Promise<ServiceCatalog["notes.remove"]["output"]>;
    write: (input: ServiceCatalog["notes.write"]["input"]) => Promise<ServiceCatalog["notes.write"]["output"]>;
  };
  notifications: {
    archive: (input: ServiceCatalog["notifications.archive"]["input"]) => Promise<ServiceCatalog["notifications.archive"]["output"]>;
    list: (input?: ServiceCatalog["notifications.list"]["input"]) => Promise<ServiceCatalog["notifications.list"]["output"]>;
    markAllRead: (input?: ServiceCatalog["notifications.markAllRead"]["input"]) => Promise<ServiceCatalog["notifications.markAllRead"]["output"]>;
    markRead: (input: ServiceCatalog["notifications.markRead"]["input"]) => Promise<ServiceCatalog["notifications.markRead"]["output"]>;
    preferences: (input?: ServiceCatalog["notifications.preferences"]["input"]) => Promise<ServiceCatalog["notifications.preferences"]["output"]>;
    unreadCount: (input?: ServiceCatalog["notifications.unreadCount"]["input"]) => Promise<ServiceCatalog["notifications.unreadCount"]["output"]>;
    updatePreference: (input: ServiceCatalog["notifications.updatePreference"]["input"]) => Promise<ServiceCatalog["notifications.updatePreference"]["output"]>;
    updatePreferences: (input: ServiceCatalog["notifications.updatePreferences"]["input"]) => Promise<ServiceCatalog["notifications.updatePreferences"]["output"]>;
    updateSettings: (input: ServiceCatalog["notifications.updateSettings"]["input"]) => Promise<ServiceCatalog["notifications.updateSettings"]["output"]>;
  };
  paywalls: {
    evaluate: (input: ServiceCatalog["paywalls.evaluate"]["input"]) => Promise<ServiceCatalog["paywalls.evaluate"]["output"]>;
    list: (input?: ServiceCatalog["paywalls.list"]["input"]) => Promise<ServiceCatalog["paywalls.list"]["output"]>;
    save: (input: ServiceCatalog["paywalls.save"]["input"]) => Promise<ServiceCatalog["paywalls.save"]["output"]>;
  };
  platform: {
    applyUpdate: (input?: ServiceCatalog["platform.applyUpdate"]["input"]) => Promise<ServiceCatalog["platform.applyUpdate"]["output"]>;
    cancelJob: (input: ServiceCatalog["platform.cancelJob"]["input"]) => Promise<ServiceCatalog["platform.cancelJob"]["output"]>;
    checkUpdates: (input?: ServiceCatalog["platform.checkUpdates"]["input"]) => Promise<ServiceCatalog["platform.checkUpdates"]["output"]>;
    compatibility: (input?: ServiceCatalog["platform.compatibility"]["input"]) => Promise<ServiceCatalog["platform.compatibility"]["output"]>;
    cspViolations: (input?: ServiceCatalog["platform.cspViolations"]["input"]) => Promise<ServiceCatalog["platform.cspViolations"]["output"]>;
    describeRelease: (input?: ServiceCatalog["platform.describeRelease"]["input"]) => Promise<ServiceCatalog["platform.describeRelease"]["output"]>;
    describeUpdateTargets: (input?: ServiceCatalog["platform.describeUpdateTargets"]["input"]) => Promise<ServiceCatalog["platform.describeUpdateTargets"]["output"]>;
    doctor: (input?: ServiceCatalog["platform.doctor"]["input"]) => Promise<ServiceCatalog["platform.doctor"]["output"]>;
    evaluateUpdatePolicy: (input: ServiceCatalog["platform.evaluateUpdatePolicy"]["input"]) => Promise<ServiceCatalog["platform.evaluateUpdatePolicy"]["output"]>;
    export: (input?: ServiceCatalog["platform.export"]["input"]) => Promise<ServiceCatalog["platform.export"]["output"]>;
    forkStatus: (input?: ServiceCatalog["platform.forkStatus"]["input"]) => Promise<ServiceCatalog["platform.forkStatus"]["output"]>;
    getJob: (input: ServiceCatalog["platform.getJob"]["input"]) => Promise<ServiceCatalog["platform.getJob"]["output"]>;
    getOutboxEvent: (input: ServiceCatalog["platform.getOutboxEvent"]["input"]) => Promise<ServiceCatalog["platform.getOutboxEvent"]["output"]>;
    getUpdatePolicy: (input?: ServiceCatalog["platform.getUpdatePolicy"]["input"]) => Promise<ServiceCatalog["platform.getUpdatePolicy"]["output"]>;
    inspectSeams: (input?: ServiceCatalog["platform.inspectSeams"]["input"]) => Promise<ServiceCatalog["platform.inspectSeams"]["output"]>;
    jobSummary: (input?: ServiceCatalog["platform.jobSummary"]["input"]) => Promise<ServiceCatalog["platform.jobSummary"]["output"]>;
    listJobQueues: (input?: ServiceCatalog["platform.listJobQueues"]["input"]) => Promise<ServiceCatalog["platform.listJobQueues"]["output"]>;
    listJobs: (input?: ServiceCatalog["platform.listJobs"]["input"]) => Promise<ServiceCatalog["platform.listJobs"]["output"]>;
    listOutboxEvents: (input?: ServiceCatalog["platform.listOutboxEvents"]["input"]) => Promise<ServiceCatalog["platform.listOutboxEvents"]["output"]>;
    listUpdateRuns: (input?: ServiceCatalog["platform.listUpdateRuns"]["input"]) => Promise<ServiceCatalog["platform.listUpdateRuns"]["output"]>;
    openForkUpdate: (input?: ServiceCatalog["platform.openForkUpdate"]["input"]) => Promise<ServiceCatalog["platform.openForkUpdate"]["output"]>;
    outboxSummary: (input?: ServiceCatalog["platform.outboxSummary"]["input"]) => Promise<ServiceCatalog["platform.outboxSummary"]["output"]>;
    preflightUpdate: (input?: ServiceCatalog["platform.preflightUpdate"]["input"]) => Promise<ServiceCatalog["platform.preflightUpdate"]["output"]>;
    redriveDeadLetters: (input: ServiceCatalog["platform.redriveDeadLetters"]["input"]) => Promise<ServiceCatalog["platform.redriveDeadLetters"]["output"]>;
    replayOutboxEvent: (input: ServiceCatalog["platform.replayOutboxEvent"]["input"]) => Promise<ServiceCatalog["platform.replayOutboxEvent"]["output"]>;
    retryJob: (input: ServiceCatalog["platform.retryJob"]["input"]) => Promise<ServiceCatalog["platform.retryJob"]["output"]>;
    saveUpdatePolicy: (input: ServiceCatalog["platform.saveUpdatePolicy"]["input"]) => Promise<ServiceCatalog["platform.saveUpdatePolicy"]["output"]>;
    source: (input?: ServiceCatalog["platform.source"]["input"]) => Promise<ServiceCatalog["platform.source"]["output"]>;
    updateCheckPolicy: (input?: ServiceCatalog["platform.updateCheckPolicy"]["input"]) => Promise<ServiceCatalog["platform.updateCheckPolicy"]["output"]>;
    verifyReleaseFeed: (input: ServiceCatalog["platform.verifyReleaseFeed"]["input"]) => Promise<ServiceCatalog["platform.verifyReleaseFeed"]["output"]>;
    version: (input?: ServiceCatalog["platform.version"]["input"]) => Promise<ServiceCatalog["platform.version"]["output"]>;
  };
  plugins: {
    addRegistry: (input: ServiceCatalog["plugins.addRegistry"]["input"]) => Promise<ServiceCatalog["plugins.addRegistry"]["output"]>;
    cacheRegistry: (input: ServiceCatalog["plugins.cacheRegistry"]["input"]) => Promise<ServiceCatalog["plugins.cacheRegistry"]["output"]>;
    disable: (input: ServiceCatalog["plugins.disable"]["input"]) => Promise<ServiceCatalog["plugins.disable"]["output"]>;
    enable: (input: ServiceCatalog["plugins.enable"]["input"]) => Promise<ServiceCatalog["plugins.enable"]["output"]>;
    get: (input: ServiceCatalog["plugins.get"]["input"]) => Promise<ServiceCatalog["plugins.get"]["output"]>;
    install: (input: ServiceCatalog["plugins.install"]["input"]) => Promise<ServiceCatalog["plugins.install"]["output"]>;
    list: (input?: ServiceCatalog["plugins.list"]["input"]) => Promise<ServiceCatalog["plugins.list"]["output"]>;
    listCatalog: (input?: ServiceCatalog["plugins.listCatalog"]["input"]) => Promise<ServiceCatalog["plugins.listCatalog"]["output"]>;
    listRegistries: (input?: ServiceCatalog["plugins.listRegistries"]["input"]) => Promise<ServiceCatalog["plugins.listRegistries"]["output"]>;
    rollback: (input: ServiceCatalog["plugins.rollback"]["input"]) => Promise<ServiceCatalog["plugins.rollback"]["output"]>;
    uninstall: (input: ServiceCatalog["plugins.uninstall"]["input"]) => Promise<ServiceCatalog["plugins.uninstall"]["output"]>;
    update: (input: ServiceCatalog["plugins.update"]["input"]) => Promise<ServiceCatalog["plugins.update"]["output"]>;
  };
  popups: {
    capture: (input: ServiceCatalog["popups.capture"]["input"]) => Promise<ServiceCatalog["popups.capture"]["output"]>;
    decide: (input?: ServiceCatalog["popups.decide"]["input"]) => Promise<ServiceCatalog["popups.decide"]["output"]>;
    get: (input: ServiceCatalog["popups.get"]["input"]) => Promise<ServiceCatalog["popups.get"]["output"]>;
    list: (input?: ServiceCatalog["popups.list"]["input"]) => Promise<ServiceCatalog["popups.list"]["output"]>;
    performance: (input?: ServiceCatalog["popups.performance"]["input"]) => Promise<ServiceCatalog["popups.performance"]["output"]>;
    record: (input: ServiceCatalog["popups.record"]["input"]) => Promise<ServiceCatalog["popups.record"]["output"]>;
    remove: (input: ServiceCatalog["popups.remove"]["input"]) => Promise<ServiceCatalog["popups.remove"]["output"]>;
    save: (input: ServiceCatalog["popups.save"]["input"]) => Promise<ServiceCatalog["popups.save"]["output"]>;
    saveBlocks: (input: ServiceCatalog["popups.saveBlocks"]["input"]) => Promise<ServiceCatalog["popups.saveBlocks"]["output"]>;
    setStatus: (input: ServiceCatalog["popups.setStatus"]["input"]) => Promise<ServiceCatalog["popups.setStatus"]["output"]>;
  };
  portal: {
    myProfile: (input?: ServiceCatalog["portal.myProfile"]["input"]) => Promise<ServiceCatalog["portal.myProfile"]["output"]>;
    myRecords: (input?: ServiceCatalog["portal.myRecords"]["input"]) => Promise<ServiceCatalog["portal.myRecords"]["output"]>;
    updateMyProfile: (input?: ServiceCatalog["portal.updateMyProfile"]["input"]) => Promise<ServiceCatalog["portal.updateMyProfile"]["output"]>;
  };
  printOnDemand: {
    list: (input?: ServiceCatalog["printOnDemand.list"]["input"]) => Promise<ServiceCatalog["printOnDemand.list"]["output"]>;
    queue: (input: ServiceCatalog["printOnDemand.queue"]["input"]) => Promise<ServiceCatalog["printOnDemand.queue"]["output"]>;
    submit: (input: ServiceCatalog["printOnDemand.submit"]["input"]) => Promise<ServiceCatalog["printOnDemand.submit"]["output"]>;
  };
  privacy: {
    cancelMyDataRequest: (input: ServiceCatalog["privacy.cancelMyDataRequest"]["input"]) => Promise<ServiceCatalog["privacy.cancelMyDataRequest"]["output"]>;
    createMyDataRequest: (input: ServiceCatalog["privacy.createMyDataRequest"]["input"]) => Promise<ServiceCatalog["privacy.createMyDataRequest"]["output"]>;
    downloadMyDataRequestArtifact: (input: ServiceCatalog["privacy.downloadMyDataRequestArtifact"]["input"]) => Promise<ServiceCatalog["privacy.downloadMyDataRequestArtifact"]["output"]>;
    getMyProfile: (input?: ServiceCatalog["privacy.getMyProfile"]["input"]) => Promise<ServiceCatalog["privacy.getMyProfile"]["output"]>;
    listMyDataRequests: (input?: ServiceCatalog["privacy.listMyDataRequests"]["input"]) => Promise<ServiceCatalog["privacy.listMyDataRequests"]["output"]>;
    setMyMarketingPreference: (input: ServiceCatalog["privacy.setMyMarketingPreference"]["input"]) => Promise<ServiceCatalog["privacy.setMyMarketingPreference"]["output"]>;
  };
  projects: {
    addTask: (input: ServiceCatalog["projects.addTask"]["input"]) => Promise<ServiceCatalog["projects.addTask"]["output"]>;
    addTestimonial: (input: ServiceCatalog["projects.addTestimonial"]["input"]) => Promise<ServiceCatalog["projects.addTestimonial"]["output"]>;
    addToCollection: (input: ServiceCatalog["projects.addToCollection"]["input"]) => Promise<ServiceCatalog["projects.addToCollection"]["output"]>;
    attachFile: (input: ServiceCatalog["projects.attachFile"]["input"]) => Promise<ServiceCatalog["projects.attachFile"]["output"]>;
    create: (input: ServiceCatalog["projects.create"]["input"]) => Promise<ServiceCatalog["projects.create"]["output"]>;
    createCollection: (input: ServiceCatalog["projects.createCollection"]["input"]) => Promise<ServiceCatalog["projects.createCollection"]["output"]>;
    detachFile: (input: ServiceCatalog["projects.detachFile"]["input"]) => Promise<ServiceCatalog["projects.detachFile"]["output"]>;
    forSubject: (input: ServiceCatalog["projects.forSubject"]["input"]) => Promise<ServiceCatalog["projects.forSubject"]["output"]>;
    get: (input: ServiceCatalog["projects.get"]["input"]) => Promise<ServiceCatalog["projects.get"]["output"]>;
    getCollection: (input: ServiceCatalog["projects.getCollection"]["input"]) => Promise<ServiceCatalog["projects.getCollection"]["output"]>;
    link: (input: ServiceCatalog["projects.link"]["input"]) => Promise<ServiceCatalog["projects.link"]["output"]>;
    list: (input?: ServiceCatalog["projects.list"]["input"]) => Promise<ServiceCatalog["projects.list"]["output"]>;
    listCollections: (input?: ServiceCatalog["projects.listCollections"]["input"]) => Promise<ServiceCatalog["projects.listCollections"]["output"]>;
    portfolioBrowse: (input?: ServiceCatalog["projects.portfolioBrowse"]["input"]) => Promise<ServiceCatalog["projects.portfolioBrowse"]["output"]>;
    publicForService: (input: ServiceCatalog["projects.publicForService"]["input"]) => Promise<ServiceCatalog["projects.publicForService"]["output"]>;
    publish: (input: ServiceCatalog["projects.publish"]["input"]) => Promise<ServiceCatalog["projects.publish"]["output"]>;
    publishCollection: (input: ServiceCatalog["projects.publishCollection"]["input"]) => Promise<ServiceCatalog["projects.publishCollection"]["output"]>;
    recordConsent: (input: ServiceCatalog["projects.recordConsent"]["input"]) => Promise<ServiceCatalog["projects.recordConsent"]["output"]>;
    removeFromCollection: (input: ServiceCatalog["projects.removeFromCollection"]["input"]) => Promise<ServiceCatalog["projects.removeFromCollection"]["output"]>;
    removeOutcome: (input: ServiceCatalog["projects.removeOutcome"]["input"]) => Promise<ServiceCatalog["projects.removeOutcome"]["output"]>;
    removeTask: (input: ServiceCatalog["projects.removeTask"]["input"]) => Promise<ServiceCatalog["projects.removeTask"]["output"]>;
    resolvePublicProject: (input: ServiceCatalog["projects.resolvePublicProject"]["input"]) => Promise<ServiceCatalog["projects.resolvePublicProject"]["output"]>;
    revokeConsent: (input: ServiceCatalog["projects.revokeConsent"]["input"]) => Promise<ServiceCatalog["projects.revokeConsent"]["output"]>;
    saveCaseStudy: (input: ServiceCatalog["projects.saveCaseStudy"]["input"]) => Promise<ServiceCatalog["projects.saveCaseStudy"]["output"]>;
    setOutcome: (input: ServiceCatalog["projects.setOutcome"]["input"]) => Promise<ServiceCatalog["projects.setOutcome"]["output"]>;
    setTaskStatus: (input: ServiceCatalog["projects.setTaskStatus"]["input"]) => Promise<ServiceCatalog["projects.setTaskStatus"]["output"]>;
    setTestimonialStatus: (input: ServiceCatalog["projects.setTestimonialStatus"]["input"]) => Promise<ServiceCatalog["projects.setTestimonialStatus"]["output"]>;
    unlink: (input: ServiceCatalog["projects.unlink"]["input"]) => Promise<ServiceCatalog["projects.unlink"]["output"]>;
    unpublish: (input: ServiceCatalog["projects.unpublish"]["input"]) => Promise<ServiceCatalog["projects.unpublish"]["output"]>;
    unpublishCollection: (input: ServiceCatalog["projects.unpublishCollection"]["input"]) => Promise<ServiceCatalog["projects.unpublishCollection"]["output"]>;
    update: (input: ServiceCatalog["projects.update"]["input"]) => Promise<ServiceCatalog["projects.update"]["output"]>;
    updateCaseStudySettings: (input: ServiceCatalog["projects.updateCaseStudySettings"]["input"]) => Promise<ServiceCatalog["projects.updateCaseStudySettings"]["output"]>;
    updateCollection: (input: ServiceCatalog["projects.updateCollection"]["input"]) => Promise<ServiceCatalog["projects.updateCollection"]["output"]>;
  };
  proof: {
    publishedPaths: (input?: ServiceCatalog["proof.publishedPaths"]["input"]) => Promise<ServiceCatalog["proof.publishedPaths"]["output"]>;
    seedNotice: (input?: ServiceCatalog["proof.seedNotice"]["input"]) => Promise<ServiceCatalog["proof.seedNotice"]["output"]>;
  };
  quotes: {
    accept: (input: ServiceCatalog["quotes.accept"]["input"]) => Promise<ServiceCatalog["quotes.accept"]["output"]>;
    byPartnerToken: (input: ServiceCatalog["quotes.byPartnerToken"]["input"]) => Promise<ServiceCatalog["quotes.byPartnerToken"]["output"]>;
    byToken: (input: ServiceCatalog["quotes.byToken"]["input"]) => Promise<ServiceCatalog["quotes.byToken"]["output"]>;
    chooseOptions: (input: ServiceCatalog["quotes.chooseOptions"]["input"]) => Promise<ServiceCatalog["quotes.chooseOptions"]["output"]>;
    convert: (input: ServiceCatalog["quotes.convert"]["input"]) => Promise<ServiceCatalog["quotes.convert"]["output"]>;
    create: (input: ServiceCatalog["quotes.create"]["input"]) => Promise<ServiceCatalog["quotes.create"]["output"]>;
    decline: (input: ServiceCatalog["quotes.decline"]["input"]) => Promise<ServiceCatalog["quotes.decline"]["output"]>;
    expire: (input?: ServiceCatalog["quotes.expire"]["input"]) => Promise<ServiceCatalog["quotes.expire"]["output"]>;
    get: (input: ServiceCatalog["quotes.get"]["input"]) => Promise<ServiceCatalog["quotes.get"]["output"]>;
    invitePartner: (input: ServiceCatalog["quotes.invitePartner"]["input"]) => Promise<ServiceCatalog["quotes.invitePartner"]["output"]>;
    list: (input?: ServiceCatalog["quotes.list"]["input"]) => Promise<ServiceCatalog["quotes.list"]["output"]>;
    loadDemoFixture: (input: ServiceCatalog["quotes.loadDemoFixture"]["input"]) => Promise<ServiceCatalog["quotes.loadDemoFixture"]["output"]>;
    markViewed: (input: ServiceCatalog["quotes.markViewed"]["input"]) => Promise<ServiceCatalog["quotes.markViewed"]["output"]>;
    message: (input: ServiceCatalog["quotes.message"]["input"]) => Promise<ServiceCatalog["quotes.message"]["output"]>;
    purgeDemoFixture: (input: ServiceCatalog["quotes.purgeDemoFixture"]["input"]) => Promise<ServiceCatalog["quotes.purgeDemoFixture"]["output"]>;
    revise: (input: ServiceCatalog["quotes.revise"]["input"]) => Promise<ServiceCatalog["quotes.revise"]["output"]>;
    revokePartner: (input: ServiceCatalog["quotes.revokePartner"]["input"]) => Promise<ServiceCatalog["quotes.revokePartner"]["output"]>;
    send: (input: ServiceCatalog["quotes.send"]["input"]) => Promise<ServiceCatalog["quotes.send"]["output"]>;
    setConversion: (input: ServiceCatalog["quotes.setConversion"]["input"]) => Promise<ServiceCatalog["quotes.setConversion"]["output"]>;
    setItems: (input: ServiceCatalog["quotes.setItems"]["input"]) => Promise<ServiceCatalog["quotes.setItems"]["output"]>;
    verifyDemoFixture: (input: ServiceCatalog["quotes.verifyDemoFixture"]["input"]) => Promise<ServiceCatalog["quotes.verifyDemoFixture"]["output"]>;
  };
  referrals: {
    acceptInvitation: (input: ServiceCatalog["referrals.acceptInvitation"]["input"]) => Promise<ServiceCatalog["referrals.acceptInvitation"]["output"]>;
    approvePayoutBatch: (input: ServiceCatalog["referrals.approvePayoutBatch"]["input"]) => Promise<ServiceCatalog["referrals.approvePayoutBatch"]["output"]>;
    attributionFor: (input: ServiceCatalog["referrals.attributionFor"]["input"]) => Promise<ServiceCatalog["referrals.attributionFor"]["output"]>;
    buildPayoutBatch: (input: ServiceCatalog["referrals.buildPayoutBatch"]["input"]) => Promise<ServiceCatalog["referrals.buildPayoutBatch"]["output"]>;
    codes: (input?: ServiceCatalog["referrals.codes"]["input"]) => Promise<ServiceCatalog["referrals.codes"]["output"]>;
    commissions: (input?: ServiceCatalog["referrals.commissions"]["input"]) => Promise<ServiceCatalog["referrals.commissions"]["output"]>;
    invitations: (input?: ServiceCatalog["referrals.invitations"]["input"]) => Promise<ServiceCatalog["referrals.invitations"]["output"]>;
    invite: (input: ServiceCatalog["referrals.invite"]["input"]) => Promise<ServiceCatalog["referrals.invite"]["output"]>;
    issueCode: (input: ServiceCatalog["referrals.issueCode"]["input"]) => Promise<ServiceCatalog["referrals.issueCode"]["output"]>;
    markPayoutBatchPaid: (input: ServiceCatalog["referrals.markPayoutBatchPaid"]["input"]) => Promise<ServiceCatalog["referrals.markPayoutBatchPaid"]["output"]>;
    payoutBatchCsv: (input: ServiceCatalog["referrals.payoutBatchCsv"]["input"]) => Promise<ServiceCatalog["referrals.payoutBatchCsv"]["output"]>;
    payoutBatches: (input?: ServiceCatalog["referrals.payoutBatches"]["input"]) => Promise<ServiceCatalog["referrals.payoutBatches"]["output"]>;
    payoutLines: (input: ServiceCatalog["referrals.payoutLines"]["input"]) => Promise<ServiceCatalog["referrals.payoutLines"]["output"]>;
    programs: (input?: ServiceCatalog["referrals.programs"]["input"]) => Promise<ServiceCatalog["referrals.programs"]["output"]>;
    recordTouch: (input: ServiceCatalog["referrals.recordTouch"]["input"]) => Promise<ServiceCatalog["referrals.recordTouch"]["output"]>;
    saveProgram: (input: ServiceCatalog["referrals.saveProgram"]["input"]) => Promise<ServiceCatalog["referrals.saveProgram"]["output"]>;
    saveTaxProfile: (input: ServiceCatalog["referrals.saveTaxProfile"]["input"]) => Promise<ServiceCatalog["referrals.saveTaxProfile"]["output"]>;
    taxPrompts: (input: ServiceCatalog["referrals.taxPrompts"]["input"]) => Promise<ServiceCatalog["referrals.taxPrompts"]["output"]>;
  };
  rentals: {
    close: (input: ServiceCatalog["rentals.close"]["input"]) => Promise<ServiceCatalog["rentals.close"]["output"]>;
    handOver: (input: ServiceCatalog["rentals.handOver"]["input"]) => Promise<ServiceCatalog["rentals.handOver"]["output"]>;
    list: (input?: ServiceCatalog["rentals.list"]["input"]) => Promise<ServiceCatalog["rentals.list"]["output"]>;
    listTerms: (input?: ServiceCatalog["rentals.listTerms"]["input"]) => Promise<ServiceCatalog["rentals.listTerms"]["output"]>;
    markOverdue: (input?: ServiceCatalog["rentals.markOverdue"]["input"]) => Promise<ServiceCatalog["rentals.markOverdue"]["output"]>;
    quote: (input: ServiceCatalog["rentals.quote"]["input"]) => Promise<ServiceCatalog["rentals.quote"]["output"]>;
    reserve: (input: ServiceCatalog["rentals.reserve"]["input"]) => Promise<ServiceCatalog["rentals.reserve"]["output"]>;
    setTerms: (input: ServiceCatalog["rentals.setTerms"]["input"]) => Promise<ServiceCatalog["rentals.setTerms"]["output"]>;
    takeBack: (input: ServiceCatalog["rentals.takeBack"]["input"]) => Promise<ServiceCatalog["rentals.takeBack"]["output"]>;
  };
  reporting: {
    loadDemoFixture: (input: ServiceCatalog["reporting.loadDemoFixture"]["input"]) => Promise<ServiceCatalog["reporting.loadDemoFixture"]["output"]>;
    purgeDemoFixture: (input: ServiceCatalog["reporting.purgeDemoFixture"]["input"]) => Promise<ServiceCatalog["reporting.purgeDemoFixture"]["output"]>;
    verifyDemoFixture: (input: ServiceCatalog["reporting.verifyDemoFixture"]["input"]) => Promise<ServiceCatalog["reporting.verifyDemoFixture"]["output"]>;
  };
  reports: {
    cohort: (input?: ServiceCatalog["reports.cohort"]["input"]) => Promise<ServiceCatalog["reports.cohort"]["output"]>;
    definitions: (input?: ServiceCatalog["reports.definitions"]["input"]) => Promise<ServiceCatalog["reports.definitions"]["output"]>;
    deleteExport: (input: ServiceCatalog["reports.deleteExport"]["input"]) => Promise<ServiceCatalog["reports.deleteExport"]["output"]>;
    deleteView: (input: ServiceCatalog["reports.deleteView"]["input"]) => Promise<ServiceCatalog["reports.deleteView"]["output"]>;
    downloadExport: (input: ServiceCatalog["reports.downloadExport"]["input"]) => Promise<ServiceCatalog["reports.downloadExport"]["output"]>;
    exportFile: (input: ServiceCatalog["reports.exportFile"]["input"]) => Promise<ServiceCatalog["reports.exportFile"]["output"]>;
    funnel: (input?: ServiceCatalog["reports.funnel"]["input"]) => Promise<ServiceCatalog["reports.funnel"]["output"]>;
    listExportRuns: (input: ServiceCatalog["reports.listExportRuns"]["input"]) => Promise<ServiceCatalog["reports.listExportRuns"]["output"]>;
    listExports: (input?: ServiceCatalog["reports.listExports"]["input"]) => Promise<ServiceCatalog["reports.listExports"]["output"]>;
    listViews: (input?: ServiceCatalog["reports.listViews"]["input"]) => Promise<ServiceCatalog["reports.listViews"]["output"]>;
    queueExportRunDelivery: (input: ServiceCatalog["reports.queueExportRunDelivery"]["input"]) => Promise<ServiceCatalog["reports.queueExportRunDelivery"]["output"]>;
    revenue: (input?: ServiceCatalog["reports.revenue"]["input"]) => Promise<ServiceCatalog["reports.revenue"]["output"]>;
    revenueBy: (input: ServiceCatalog["reports.revenueBy"]["input"]) => Promise<ServiceCatalog["reports.revenueBy"]["output"]>;
    runExport: (input: ServiceCatalog["reports.runExport"]["input"]) => Promise<ServiceCatalog["reports.runExport"]["output"]>;
    saveExport: (input: ServiceCatalog["reports.saveExport"]["input"]) => Promise<ServiceCatalog["reports.saveExport"]["output"]>;
    saveView: (input: ServiceCatalog["reports.saveView"]["input"]) => Promise<ServiceCatalog["reports.saveView"]["output"]>;
  };
  reviews: {
    aggregate: (input?: ServiceCatalog["reviews.aggregate"]["input"]) => Promise<ServiceCatalog["reviews.aggregate"]["output"]>;
    ingestExternal: (input: ServiceCatalog["reviews.ingestExternal"]["input"]) => Promise<ServiceCatalog["reviews.ingestExternal"]["output"]>;
    list: (input?: ServiceCatalog["reviews.list"]["input"]) => Promise<ServiceCatalog["reviews.list"]["output"]>;
    moderate: (input: ServiceCatalog["reviews.moderate"]["input"]) => Promise<ServiceCatalog["reviews.moderate"]["output"]>;
    published: (input?: ServiceCatalog["reviews.published"]["input"]) => Promise<ServiceCatalog["reviews.published"]["output"]>;
    reply: (input: ServiceCatalog["reviews.reply"]["input"]) => Promise<ServiceCatalog["reviews.reply"]["output"]>;
    request: (input: ServiceCatalog["reviews.request"]["input"]) => Promise<ServiceCatalog["reviews.request"]["output"]>;
    submit: (input: ServiceCatalog["reviews.submit"]["input"]) => Promise<ServiceCatalog["reviews.submit"]["output"]>;
  };
  roles: {
    assign: (input: ServiceCatalog["roles.assign"]["input"]) => Promise<ServiceCatalog["roles.assign"]["output"]>;
    create: (input: ServiceCatalog["roles.create"]["input"]) => Promise<ServiceCatalog["roles.create"]["output"]>;
    delete: (input: ServiceCatalog["roles.delete"]["input"]) => Promise<ServiceCatalog["roles.delete"]["output"]>;
    list: (input?: ServiceCatalog["roles.list"]["input"]) => Promise<ServiceCatalog["roles.list"]["output"]>;
    modules: (input?: ServiceCatalog["roles.modules"]["input"]) => Promise<ServiceCatalog["roles.modules"]["output"]>;
    update: (input: ServiceCatalog["roles.update"]["input"]) => Promise<ServiceCatalog["roles.update"]["output"]>;
    users: (input?: ServiceCatalog["roles.users"]["input"]) => Promise<ServiceCatalog["roles.users"]["output"]>;
  };
  scheduling: {
    slots: (input: ServiceCatalog["scheduling.slots"]["input"]) => Promise<ServiceCatalog["scheduling.slots"]["output"]>;
  };
  scoring: {
    advance: (input: ServiceCatalog["scoring.advance"]["input"]) => Promise<ServiceCatalog["scoring.advance"]["output"]>;
    applyThresholds: (input: ServiceCatalog["scoring.applyThresholds"]["input"]) => Promise<ServiceCatalog["scoring.applyThresholds"]["output"]>;
    award: (input: ServiceCatalog["scoring.award"]["input"]) => Promise<ServiceCatalog["scoring.award"]["output"]>;
    for: (input: ServiceCatalog["scoring.for"]["input"]) => Promise<ServiceCatalog["scoring.for"]["output"]>;
    removeRule: (input: ServiceCatalog["scoring.removeRule"]["input"]) => Promise<ServiceCatalog["scoring.removeRule"]["output"]>;
    rules: (input?: ServiceCatalog["scoring.rules"]["input"]) => Promise<ServiceCatalog["scoring.rules"]["output"]>;
    saveRule: (input: ServiceCatalog["scoring.saveRule"]["input"]) => Promise<ServiceCatalog["scoring.saveRule"]["output"]>;
    why: (input: ServiceCatalog["scoring.why"]["input"]) => Promise<ServiceCatalog["scoring.why"]["output"]>;
  };
  seed: {
    installPreset: (input: ServiceCatalog["seed.installPreset"]["input"]) => Promise<ServiceCatalog["seed.installPreset"]["output"]>;
  };
  segments: {
    capture: (input: ServiceCatalog["segments.capture"]["input"]) => Promise<ServiceCatalog["segments.capture"]["output"]>;
    contains: (input: ServiceCatalog["segments.contains"]["input"]) => Promise<ServiceCatalog["segments.contains"]["output"]>;
    fields: (input?: ServiceCatalog["segments.fields"]["input"]) => Promise<ServiceCatalog["segments.fields"]["output"]>;
    list: (input?: ServiceCatalog["segments.list"]["input"]) => Promise<ServiceCatalog["segments.list"]["output"]>;
    members: (input?: ServiceCatalog["segments.members"]["input"]) => Promise<ServiceCatalog["segments.members"]["output"]>;
    preview: (input: ServiceCatalog["segments.preview"]["input"]) => Promise<ServiceCatalog["segments.preview"]["output"]>;
    remove: (input: ServiceCatalog["segments.remove"]["input"]) => Promise<ServiceCatalog["segments.remove"]["output"]>;
    save: (input: ServiceCatalog["segments.save"]["input"]) => Promise<ServiceCatalog["segments.save"]["output"]>;
    why: (input: ServiceCatalog["segments.why"]["input"]) => Promise<ServiceCatalog["segments.why"]["output"]>;
  };
  seo: {
    deleteRedirect: (input: ServiceCatalog["seo.deleteRedirect"]["input"]) => Promise<ServiceCatalog["seo.deleteRedirect"]["output"]>;
    listRedirects: (input?: ServiceCatalog["seo.listRedirects"]["input"]) => Promise<ServiceCatalog["seo.listRedirects"]["output"]>;
    recordRedirect: (input: ServiceCatalog["seo.recordRedirect"]["input"]) => Promise<ServiceCatalog["seo.recordRedirect"]["output"]>;
    resolveRedirect: (input: ServiceCatalog["seo.resolveRedirect"]["input"]) => Promise<ServiceCatalog["seo.resolveRedirect"]["output"]>;
  };
  settings: {
    completeSetup: (input?: ServiceCatalog["settings.completeSetup"]["input"]) => Promise<ServiceCatalog["settings.completeSetup"]["output"]>;
    finishSetupAsOwner: (input?: ServiceCatalog["settings.finishSetupAsOwner"]["input"]) => Promise<ServiceCatalog["settings.finishSetupAsOwner"]["output"]>;
    getBusiness: (input?: ServiceCatalog["settings.getBusiness"]["input"]) => Promise<ServiceCatalog["settings.getBusiness"]["output"]>;
    getDesign: (input?: ServiceCatalog["settings.getDesign"]["input"]) => Promise<ServiceCatalog["settings.getDesign"]["output"]>;
    getModuleConfig: (input: ServiceCatalog["settings.getModuleConfig"]["input"]) => Promise<ServiceCatalog["settings.getModuleConfig"]["output"]>;
    listModules: (input?: ServiceCatalog["settings.listModules"]["input"]) => Promise<ServiceCatalog["settings.listModules"]["output"]>;
    patchBusiness: (input?: ServiceCatalog["settings.patchBusiness"]["input"]) => Promise<ServiceCatalog["settings.patchBusiness"]["output"]>;
    resetDesign: (input?: ServiceCatalog["settings.resetDesign"]["input"]) => Promise<ServiceCatalog["settings.resetDesign"]["output"]>;
    saveSetupBusiness: (input: ServiceCatalog["settings.saveSetupBusiness"]["input"]) => Promise<ServiceCatalog["settings.saveSetupBusiness"]["output"]>;
    setModuleConfig: (input: ServiceCatalog["settings.setModuleConfig"]["input"]) => Promise<ServiceCatalog["settings.setModuleConfig"]["output"]>;
    setModuleEnabled: (input: ServiceCatalog["settings.setModuleEnabled"]["input"]) => Promise<ServiceCatalog["settings.setModuleEnabled"]["output"]>;
    setupState: (input?: ServiceCatalog["settings.setupState"]["input"]) => Promise<ServiceCatalog["settings.setupState"]["output"]>;
    updateBusiness: (input: ServiceCatalog["settings.updateBusiness"]["input"]) => Promise<ServiceCatalog["settings.updateBusiness"]["output"]>;
    updateDesign: (input?: ServiceCatalog["settings.updateDesign"]["input"]) => Promise<ServiceCatalog["settings.updateDesign"]["output"]>;
  };
  share: {
    embedSnippet: (input: ServiceCatalog["share.embedSnippet"]["input"]) => Promise<ServiceCatalog["share.embedSnippet"]["output"]>;
    forgetTarget: (input: ServiceCatalog["share.forgetTarget"]["input"]) => Promise<ServiceCatalog["share.forgetTarget"]["output"]>;
    linkReport: (input?: ServiceCatalog["share.linkReport"]["input"]) => Promise<ServiceCatalog["share.linkReport"]["output"]>;
    resolveLink: (input: ServiceCatalog["share.resolveLink"]["input"]) => Promise<ServiceCatalog["share.resolveLink"]["output"]>;
    saveTarget: (input: ServiceCatalog["share.saveTarget"]["input"]) => Promise<ServiceCatalog["share.saveTarget"]["output"]>;
    shareVia: (input: ServiceCatalog["share.shareVia"]["input"]) => Promise<ServiceCatalog["share.shareVia"]["output"]>;
    targetFor: (input: ServiceCatalog["share.targetFor"]["input"]) => Promise<ServiceCatalog["share.targetFor"]["output"]>;
    targets: (input?: ServiceCatalog["share.targets"]["input"]) => Promise<ServiceCatalog["share.targets"]["output"]>;
  };
  signupContactImports: {
    beginOAuth: (input: ServiceCatalog["signupContactImports.beginOAuth"]["input"]) => Promise<ServiceCatalog["signupContactImports.beginOAuth"]["output"]>;
    commit: (input: ServiceCatalog["signupContactImports.commit"]["input"]) => Promise<ServiceCatalog["signupContactImports.commit"]["output"]>;
    completeOAuth: (input: ServiceCatalog["signupContactImports.completeOAuth"]["input"]) => Promise<ServiceCatalog["signupContactImports.completeOAuth"]["output"]>;
    disconnect: (input: ServiceCatalog["signupContactImports.disconnect"]["input"]) => Promise<ServiceCatalog["signupContactImports.disconnect"]["output"]>;
    get: (input: ServiceCatalog["signupContactImports.get"]["input"]) => Promise<ServiceCatalog["signupContactImports.get"]["output"]>;
    getOffer: (input?: ServiceCatalog["signupContactImports.getOffer"]["input"]) => Promise<ServiceCatalog["signupContactImports.getOffer"]["output"]>;
    getPolicy: (input?: ServiceCatalog["signupContactImports.getPolicy"]["input"]) => Promise<ServiceCatalog["signupContactImports.getPolicy"]["output"]>;
    listProviderContacts: (input: ServiceCatalog["signupContactImports.listProviderContacts"]["input"]) => Promise<ServiceCatalog["signupContactImports.listProviderContacts"]["output"]>;
    revert: (input: ServiceCatalog["signupContactImports.revert"]["input"]) => Promise<ServiceCatalog["signupContactImports.revert"]["output"]>;
    setPolicy: (input: ServiceCatalog["signupContactImports.setPolicy"]["input"]) => Promise<ServiceCatalog["signupContactImports.setPolicy"]["output"]>;
    skip: (input?: ServiceCatalog["signupContactImports.skip"]["input"]) => Promise<ServiceCatalog["signupContactImports.skip"]["output"]>;
    stageDevice: (input: ServiceCatalog["signupContactImports.stageDevice"]["input"]) => Promise<ServiceCatalog["signupContactImports.stageDevice"]["output"]>;
    stageFile: (input: ServiceCatalog["signupContactImports.stageFile"]["input"]) => Promise<ServiceCatalog["signupContactImports.stageFile"]["output"]>;
    stageProvider: (input: ServiceCatalog["signupContactImports.stageProvider"]["input"]) => Promise<ServiceCatalog["signupContactImports.stageProvider"]["output"]>;
  };
  social: {
    assignProfile: (input: ServiceCatalog["social.assignProfile"]["input"]) => Promise<ServiceCatalog["social.assignProfile"]["output"]>;
    attributionReport: (input?: ServiceCatalog["social.attributionReport"]["input"]) => Promise<ServiceCatalog["social.attributionReport"]["output"]>;
    beginOAuth: (input: ServiceCatalog["social.beginOAuth"]["input"]) => Promise<ServiceCatalog["social.beginOAuth"]["output"]>;
    checkHealth: (input?: ServiceCatalog["social.checkHealth"]["input"]) => Promise<ServiceCatalog["social.checkHealth"]["output"]>;
    completeOAuth: (input: ServiceCatalog["social.completeOAuth"]["input"]) => Promise<ServiceCatalog["social.completeOAuth"]["output"]>;
    composePackage: (input?: ServiceCatalog["social.composePackage"]["input"]) => Promise<ServiceCatalog["social.composePackage"]["output"]>;
    createVariants: (input: ServiceCatalog["social.createVariants"]["input"]) => Promise<ServiceCatalog["social.createVariants"]["output"]>;
    disconnectProfile: (input: ServiceCatalog["social.disconnectProfile"]["input"]) => Promise<ServiceCatalog["social.disconnectProfile"]["output"]>;
    draftFromPackage: (input: ServiceCatalog["social.draftFromPackage"]["input"]) => Promise<ServiceCatalog["social.draftFromPackage"]["output"]>;
    ingestProfile: (input: ServiceCatalog["social.ingestProfile"]["input"]) => Promise<ServiceCatalog["social.ingestProfile"]["output"]>;
    interactionList: (input?: ServiceCatalog["social.interactionList"]["input"]) => Promise<ServiceCatalog["social.interactionList"]["output"]>;
    networks: (input?: ServiceCatalog["social.networks"]["input"]) => Promise<ServiceCatalog["social.networks"]["output"]>;
    packageList: (input?: ServiceCatalog["social.packageList"]["input"]) => Promise<ServiceCatalog["social.packageList"]["output"]>;
    profiles: (input?: ServiceCatalog["social.profiles"]["input"]) => Promise<ServiceCatalog["social.profiles"]["output"]>;
    publicationCalendar: (input?: ServiceCatalog["social.publicationCalendar"]["input"]) => Promise<ServiceCatalog["social.publicationCalendar"]["output"]>;
    publishDue: (input?: ServiceCatalog["social.publishDue"]["input"]) => Promise<ServiceCatalog["social.publishDue"]["output"]>;
    reviewProfile: (input: ServiceCatalog["social.reviewProfile"]["input"]) => Promise<ServiceCatalog["social.reviewProfile"]["output"]>;
    reviewVariant: (input: ServiceCatalog["social.reviewVariant"]["input"]) => Promise<ServiceCatalog["social.reviewVariant"]["output"]>;
    schedulePublications: (input: ServiceCatalog["social.schedulePublications"]["input"]) => Promise<ServiceCatalog["social.schedulePublications"]["output"]>;
    setPolicy: (input: ServiceCatalog["social.setPolicy"]["input"]) => Promise<ServiceCatalog["social.setPolicy"]["output"]>;
    staffMembers: (input?: ServiceCatalog["social.staffMembers"]["input"]) => Promise<ServiceCatalog["social.staffMembers"]["output"]>;
    syncGbp: (input: ServiceCatalog["social.syncGbp"]["input"]) => Promise<ServiceCatalog["social.syncGbp"]["output"]>;
    syncGbpHours: (input: ServiceCatalog["social.syncGbpHours"]["input"]) => Promise<ServiceCatalog["social.syncGbpHours"]["output"]>;
    syncGbpReviews: (input: ServiceCatalog["social.syncGbpReviews"]["input"]) => Promise<ServiceCatalog["social.syncGbpReviews"]["output"]>;
    variantList: (input?: ServiceCatalog["social.variantList"]["input"]) => Promise<ServiceCatalog["social.variantList"]["output"]>;
  };
  subscriptions: {
    attachProviderSchedule: (input: ServiceCatalog["subscriptions.attachProviderSchedule"]["input"]) => Promise<ServiceCatalog["subscriptions.attachProviderSchedule"]["output"]>;
    cancel: (input: ServiceCatalog["subscriptions.cancel"]["input"]) => Promise<ServiceCatalog["subscriptions.cancel"]["output"]>;
    cancelAgreement: (input: ServiceCatalog["subscriptions.cancelAgreement"]["input"]) => Promise<ServiceCatalog["subscriptions.cancelAgreement"]["output"]>;
    cancelMine: (input: ServiceCatalog["subscriptions.cancelMine"]["input"]) => Promise<ServiceCatalog["subscriptions.cancelMine"]["output"]>;
    cancelMyAgreement: (input: ServiceCatalog["subscriptions.cancelMyAgreement"]["input"]) => Promise<ServiceCatalog["subscriptions.cancelMyAgreement"]["output"]>;
    changeMine: (input: ServiceCatalog["subscriptions.changeMine"]["input"]) => Promise<ServiceCatalog["subscriptions.changeMine"]["output"]>;
    changePlan: (input: ServiceCatalog["subscriptions.changePlan"]["input"]) => Promise<ServiceCatalog["subscriptions.changePlan"]["output"]>;
    chargePlatformInvoice: (input: ServiceCatalog["subscriptions.chargePlatformInvoice"]["input"]) => Promise<ServiceCatalog["subscriptions.chargePlatformInvoice"]["output"]>;
    enroll: (input: ServiceCatalog["subscriptions.enroll"]["input"]) => Promise<ServiceCatalog["subscriptions.enroll"]["output"]>;
    get: (input: ServiceCatalog["subscriptions.get"]["input"]) => Promise<ServiceCatalog["subscriptions.get"]["output"]>;
    list: (input?: ServiceCatalog["subscriptions.list"]["input"]) => Promise<ServiceCatalog["subscriptions.list"]["output"]>;
    listOffered: (input?: ServiceCatalog["subscriptions.listOffered"]["input"]) => Promise<ServiceCatalog["subscriptions.listOffered"]["output"]>;
    listPlans: (input?: ServiceCatalog["subscriptions.listPlans"]["input"]) => Promise<ServiceCatalog["subscriptions.listPlans"]["output"]>;
    pause: (input: ServiceCatalog["subscriptions.pause"]["input"]) => Promise<ServiceCatalog["subscriptions.pause"]["output"]>;
    resume: (input: ServiceCatalog["subscriptions.resume"]["input"]) => Promise<ServiceCatalog["subscriptions.resume"]["output"]>;
    savePlan: (input: ServiceCatalog["subscriptions.savePlan"]["input"]) => Promise<ServiceCatalog["subscriptions.savePlan"]["output"]>;
    subscribe: (input: ServiceCatalog["subscriptions.subscribe"]["input"]) => Promise<ServiceCatalog["subscriptions.subscribe"]["output"]>;
  };
  tasks: {
    create: (input?: ServiceCatalog["tasks.create"]["input"]) => Promise<ServiceCatalog["tasks.create"]["output"]>;
    list: (input?: ServiceCatalog["tasks.list"]["input"]) => Promise<ServiceCatalog["tasks.list"]["output"]>;
    remove: (input: ServiceCatalog["tasks.remove"]["input"]) => Promise<ServiceCatalog["tasks.remove"]["output"]>;
    setStatus: (input: ServiceCatalog["tasks.setStatus"]["input"]) => Promise<ServiceCatalog["tasks.setStatus"]["output"]>;
    update: (input: ServiceCatalog["tasks.update"]["input"]) => Promise<ServiceCatalog["tasks.update"]["output"]>;
  };
  templates: {
    get: (input: ServiceCatalog["templates.get"]["input"]) => Promise<ServiceCatalog["templates.get"]["output"]>;
    list: (input?: ServiceCatalog["templates.list"]["input"]) => Promise<ServiceCatalog["templates.list"]["output"]>;
    render: (input?: ServiceCatalog["templates.render"]["input"]) => Promise<ServiceCatalog["templates.render"]["output"]>;
    reset: (input: ServiceCatalog["templates.reset"]["input"]) => Promise<ServiceCatalog["templates.reset"]["output"]>;
    save: (input: ServiceCatalog["templates.save"]["input"]) => Promise<ServiceCatalog["templates.save"]["output"]>;
    slots: (input?: ServiceCatalog["templates.slots"]["input"]) => Promise<ServiceCatalog["templates.slots"]["output"]>;
  };
  time: {
    invoice: (input: ServiceCatalog["time.invoice"]["input"]) => Promise<ServiceCatalog["time.invoice"]["output"]>;
    list: (input?: ServiceCatalog["time.list"]["input"]) => Promise<ServiceCatalog["time.list"]["output"]>;
    log: (input: ServiceCatalog["time.log"]["input"]) => Promise<ServiceCatalog["time.log"]["output"]>;
    rates: (input?: ServiceCatalog["time.rates"]["input"]) => Promise<ServiceCatalog["time.rates"]["output"]>;
    remove: (input: ServiceCatalog["time.remove"]["input"]) => Promise<ServiceCatalog["time.remove"]["output"]>;
    setRate: (input: ServiceCatalog["time.setRate"]["input"]) => Promise<ServiceCatalog["time.setRate"]["output"]>;
    start: (input: ServiceCatalog["time.start"]["input"]) => Promise<ServiceCatalog["time.start"]["output"]>;
    stop: (input?: ServiceCatalog["time.stop"]["input"]) => Promise<ServiceCatalog["time.stop"]["output"]>;
    update: (input: ServiceCatalog["time.update"]["input"]) => Promise<ServiceCatalog["time.update"]["output"]>;
  };
  views: {
    default: (input: ServiceCatalog["views.default"]["input"]) => Promise<ServiceCatalog["views.default"]["output"]>;
    entities: (input?: ServiceCatalog["views.entities"]["input"]) => Promise<ServiceCatalog["views.entities"]["output"]>;
    list: (input: ServiceCatalog["views.list"]["input"]) => Promise<ServiceCatalog["views.list"]["output"]>;
    remove: (input: ServiceCatalog["views.remove"]["input"]) => Promise<ServiceCatalog["views.remove"]["output"]>;
    save: (input: ServiceCatalog["views.save"]["input"]) => Promise<ServiceCatalog["views.save"]["output"]>;
    setDefault: (input: ServiceCatalog["views.setDefault"]["input"]) => Promise<ServiceCatalog["views.setDefault"]["output"]>;
  };
  voiceVideo: {
    list: (input?: ServiceCatalog["voiceVideo.list"]["input"]) => Promise<ServiceCatalog["voiceVideo.list"]["output"]>;
    record: (input: ServiceCatalog["voiceVideo.record"]["input"]) => Promise<ServiceCatalog["voiceVideo.record"]["output"]>;
  };
  waitlist: {
    claim: (input: ServiceCatalog["waitlist.claim"]["input"]) => Promise<ServiceCatalog["waitlist.claim"]["output"]>;
    expireOffers: (input?: ServiceCatalog["waitlist.expireOffers"]["input"]) => Promise<ServiceCatalog["waitlist.expireOffers"]["output"]>;
    join: (input: ServiceCatalog["waitlist.join"]["input"]) => Promise<ServiceCatalog["waitlist.join"]["output"]>;
    list: (input?: ServiceCatalog["waitlist.list"]["input"]) => Promise<ServiceCatalog["waitlist.list"]["output"]>;
    offer: (input: ServiceCatalog["waitlist.offer"]["input"]) => Promise<ServiceCatalog["waitlist.offer"]["output"]>;
    setPosition: (input: ServiceCatalog["waitlist.setPosition"]["input"]) => Promise<ServiceCatalog["waitlist.setPosition"]["output"]>;
    withdraw: (input: ServiceCatalog["waitlist.withdraw"]["input"]) => Promise<ServiceCatalog["waitlist.withdraw"]["output"]>;
  };
  webhooks: {
    create: (input: ServiceCatalog["webhooks.create"]["input"]) => Promise<ServiceCatalog["webhooks.create"]["output"]>;
    deliveries: (input?: ServiceCatalog["webhooks.deliveries"]["input"]) => Promise<ServiceCatalog["webhooks.deliveries"]["output"]>;
    inspectDelivery: (input: ServiceCatalog["webhooks.inspectDelivery"]["input"]) => Promise<ServiceCatalog["webhooks.inspectDelivery"]["output"]>;
    list: (input?: ServiceCatalog["webhooks.list"]["input"]) => Promise<ServiceCatalog["webhooks.list"]["output"]>;
    remove: (input: ServiceCatalog["webhooks.remove"]["input"]) => Promise<ServiceCatalog["webhooks.remove"]["output"]>;
    replay: (input: ServiceCatalog["webhooks.replay"]["input"]) => Promise<ServiceCatalog["webhooks.replay"]["output"]>;
    rotateEndpoint: (input: ServiceCatalog["webhooks.rotateEndpoint"]["input"]) => Promise<ServiceCatalog["webhooks.rotateEndpoint"]["output"]>;
    rotateSecret: (input: ServiceCatalog["webhooks.rotateSecret"]["input"]) => Promise<ServiceCatalog["webhooks.rotateSecret"]["output"]>;
    secret: (input: ServiceCatalog["webhooks.secret"]["input"]) => Promise<ServiceCatalog["webhooks.secret"]["output"]>;
    test: (input: ServiceCatalog["webhooks.test"]["input"]) => Promise<ServiceCatalog["webhooks.test"]["output"]>;
    update: (input: ServiceCatalog["webhooks.update"]["input"]) => Promise<ServiceCatalog["webhooks.update"]["output"]>;
  };
}
