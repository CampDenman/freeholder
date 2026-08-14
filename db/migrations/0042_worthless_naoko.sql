ALTER TABLE "demo_scenario_runs" ADD CONSTRAINT "demo_scenario_runs_definition_fk" FOREIGN KEY ("scenario_key","scenario_version") REFERENCES "public"."demo_scenarios"("key","version") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "demo_scenarios" (
	"key", "version", "title_key", "description_key", "preset",
	"required_modules", "required_capabilities", "fixture_manifest",
	"default_locale", "supported_locales", "tour_flow_key", "status"
) VALUES (
	'seed.current-modules', 1,
	'demo.scenario.currentModules.title',
	'demo.scenario.currentModules.description',
	'foundation',
	ARRAY['core','cms','forms','seed']::text[],
	ARRAY['demo:manage','cms:view','forms:view']::text[],
	$$[
		{
			"key":"cms.current-modules","version":1,
			"scenarioKeys":["seed.current-modules"],"dependsOn":[],
			"requiredModules":["cms"],"requiredCapabilities":["cms:view"],
			"localeVariants":["en","fr","es"],
			"records":[{"key":"project-page","subjectType":"page"}],
			"expectedOutcomes":[{"key":"cms.current-modules.visible","labelKey":"demo.outcome.pageVisible","targetKey":"core.admin-pages"}],
			"loadService":"cms.loadDemoFixture","purgeService":"cms.purgeDemoFixture","verifyService":"cms.verifyDemoFixture"
		},
		{
			"key":"forms.current-modules","version":1,
			"scenarioKeys":["seed.current-modules"],"dependsOn":[],
			"requiredModules":["forms"],"requiredCapabilities":["forms:view"],
			"localeVariants":["en","fr","es"],
			"records":[{"key":"enquiry-form","subjectType":"form"}],
			"expectedOutcomes":[{"key":"forms.current-modules.visible","labelKey":"demo.outcome.formVisible","targetKey":"core.admin-forms"}],
			"loadService":"forms.loadDemoFixture","purgeService":"forms.purgeDemoFixture","verifyService":"forms.verifyDemoFixture"
		}
	]$$::jsonb,
	'en', ARRAY['en','fr','es']::text[], 'core.owner-first-win', 'active'
)
ON CONFLICT ("key", "version") DO NOTHING;
