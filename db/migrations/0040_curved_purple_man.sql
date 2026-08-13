CREATE TABLE "guidance_flows" (
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"title_key" text NOT NULL,
	"description_key" text NOT NULL,
	"audience_roles" text[] DEFAULT '{}' NOT NULL,
	"required_capabilities" text[] DEFAULT '{}' NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guidance_flows_key_version_pk" PRIMARY KEY("key","version"),
	CONSTRAINT "guidance_flows_version_positive" CHECK ("guidance_flows"."version" > 0),
	CONSTRAINT "guidance_flows_status_valid" CHECK ("guidance_flows"."status" in ('draft', 'active', 'retired')),
	CONSTRAINT "guidance_flows_steps_array" CHECK (jsonb_typeof("guidance_flows"."steps") = 'array')
);
--> statement-breakpoint
CREATE TABLE "guidance_progress" (
	"user_id" uuid NOT NULL,
	"flow_key" text NOT NULL,
	"flow_version" integer NOT NULL,
	"completed_steps" text[] DEFAULT '{}' NOT NULL,
	"seen_steps" text[] DEFAULT '{}' NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guidance_progress_user_flow_version_pk" PRIMARY KEY("user_id","flow_key","flow_version"),
	CONSTRAINT "guidance_progress_version_positive" CHECK ("guidance_progress"."flow_version" > 0),
	CONSTRAINT "guidance_progress_state_valid" CHECK ("guidance_progress"."state" in ('active', 'dismissed', 'completed')),
	CONSTRAINT "guidance_progress_completed_consistent" CHECK (("guidance_progress"."state" = 'completed' and "guidance_progress"."completed_at" is not null) or ("guidance_progress"."state" <> 'completed' and "guidance_progress"."completed_at" is null)),
	CONSTRAINT "guidance_progress_dismissed_consistent" CHECK (("guidance_progress"."state" = 'dismissed' and "guidance_progress"."dismissed_at" is not null) or ("guidance_progress"."state" <> 'dismissed' and "guidance_progress"."dismissed_at" is null))
);
--> statement-breakpoint
ALTER TABLE "guidance_progress" ADD CONSTRAINT "guidance_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guidance_flows_status_idx" ON "guidance_flows" USING btree ("status","key","version");--> statement-breakpoint
CREATE INDEX "guidance_progress_user_state_idx" ON "guidance_progress" USING btree ("user_id","state","updated_at");--> statement-breakpoint
INSERT INTO "guidance_flows" (
	"key", "version", "title_key", "description_key",
	"audience_roles", "required_capabilities", "steps", "status"
) VALUES
(
	'core.owner-first-win', 1,
	'guidance.flow.owner.title', 'guidance.flow.owner.description',
	ARRAY['owner']::text[], ARRAY['*:manage']::text[],
	$$[
		{"key":"publish-page","titleKey":"guidance.step.publishPage.title","descriptionKey":"guidance.step.publishPage.description","href":"/admin/pages","requiredCapabilities":["cms:manage"],"outcome":{"type":"audit","actions":["cms.publishPage"]}},
		{"key":"capture-enquiry","titleKey":"guidance.step.captureEnquiry.title","descriptionKey":"guidance.step.captureEnquiry.description","href":"/admin/forms","requiredCapabilities":["forms:view"],"outcome":{"type":"form-submission"}},
		{"key":"move-customer-forward","titleKey":"guidance.step.moveCustomer.title","descriptionKey":"guidance.step.moveCustomer.description","href":"/admin/contacts","requiredCapabilities":["contacts:manage"],"outcome":{"type":"audit","actions":["contacts.update"]}}
	]$$::jsonb, 'active'
),
(
	'core.administrator-first-win', 1,
	'guidance.flow.administrator.title', 'guidance.flow.administrator.description',
	ARRAY['administrator']::text[], ARRAY['admin:manage','invitations:manage','platform:view']::text[],
	$$[
		{"key":"invite-collaborator","titleKey":"guidance.step.inviteCollaborator.title","descriptionKey":"guidance.step.inviteCollaborator.description","href":"/admin/invitations","requiredCapabilities":["invitations:manage"],"outcome":{"type":"audit","actions":["invitations.create"]}},
		{"key":"schedule-digest","titleKey":"guidance.step.scheduleDigest.title","descriptionKey":"guidance.step.scheduleDigest.description","href":"/admin/notifications#notification-schedule","requiredCapabilities":[],"outcome":{"type":"audit","actions":["notifications.updateSettings"]}}
	]$$::jsonb, 'active'
),
(
	'core.editor-first-win', 1,
	'guidance.flow.editor.title', 'guidance.flow.editor.description',
	ARRAY['editor']::text[], ARRAY['cms:manage']::text[],
	$$[
		{"key":"publish-page","titleKey":"guidance.step.publishPage.title","descriptionKey":"guidance.step.publishPage.description","href":"/admin/pages","requiredCapabilities":["cms:manage"],"outcome":{"type":"audit","actions":["cms.publishPage"]}},
		{"key":"upload-media","titleKey":"guidance.step.uploadMedia.title","descriptionKey":"guidance.step.uploadMedia.description","href":"/admin/media","requiredCapabilities":["media:manage"],"outcome":{"type":"audit","actions":["media.upload","media.completeUpload"]}},
		{"key":"launch-form","titleKey":"guidance.step.launchForm.title","descriptionKey":"guidance.step.launchForm.description","href":"/admin/forms","requiredCapabilities":["forms:manage"],"outcome":{"type":"audit","actions":["forms.create","forms.update"]}}
	]$$::jsonb, 'active'
),
(
	'core.bookkeeper-first-win', 1,
	'guidance.flow.bookkeeper.title', 'guidance.flow.bookkeeper.description',
	ARRAY['bookkeeper']::text[], ARRAY['analytics:view','contacts:view','events:view','settings:view']::text[],
	$$[
		{"key":"choose-alerts","titleKey":"guidance.step.chooseAlerts.title","descriptionKey":"guidance.step.chooseAlerts.description","href":"/admin/notifications#notification-preferences-heading","requiredCapabilities":[],"outcome":{"type":"audit","actions":["notifications.updatePreference","notifications.updatePreferences"]}},
		{"key":"schedule-digest","titleKey":"guidance.step.scheduleDigest.title","descriptionKey":"guidance.step.scheduleDigest.description","href":"/admin/notifications#notification-schedule","requiredCapabilities":[],"outcome":{"type":"audit","actions":["notifications.updateSettings"]}}
	]$$::jsonb, 'active'
),
(
	'core.service-provider-first-win', 1,
	'guidance.flow.serviceProvider.title', 'guidance.flow.serviceProvider.description',
	ARRAY['service-provider']::text[], ARRAY['contacts:manage']::text[],
	$$[
		{"key":"add-customer","titleKey":"guidance.step.addCustomer.title","descriptionKey":"guidance.step.addCustomer.description","href":"/admin/contacts/new","requiredCapabilities":["contacts:manage"],"outcome":{"type":"audit","actions":["contacts.create"]}},
		{"key":"move-customer-forward","titleKey":"guidance.step.moveCustomer.title","descriptionKey":"guidance.step.moveCustomer.description","href":"/admin/contacts","requiredCapabilities":["contacts:manage"],"outcome":{"type":"audit","actions":["contacts.update"]}}
	]$$::jsonb, 'active'
),
(
	'core.customer-first-win', 1,
	'guidance.flow.customer.title', 'guidance.flow.customer.description',
	ARRAY['customer']::text[], ARRAY[]::text[],
	$$[
		{"key":"open-private-account","titleKey":"guidance.step.openPrivateAccount.title","descriptionKey":"guidance.step.openPrivateAccount.description","href":"/portal/privacy","requiredCapabilities":[],"outcome":{"type":"portal-account-linked"}},
		{"key":"choose-contact-preference","titleKey":"guidance.step.chooseContactPreference.title","descriptionKey":"guidance.step.chooseContactPreference.description","href":"/portal/privacy#privacy-preferences","requiredCapabilities":[],"outcome":{"type":"audit","actions":["privacy.setMyMarketingPreference"]}}
	]$$::jsonb, 'active'
)
ON CONFLICT ("key", "version") DO NOTHING;
