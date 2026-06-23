DROP INDEX "access_overrides_uq";--> statement-breakpoint
DROP INDEX "user_roles_uq";--> statement-breakpoint
ALTER TABLE "access_overrides" ALTER COLUMN "scope_type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "access_overrides" ADD CONSTRAINT "access_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_overrides" ADD CONSTRAINT "access_overrides_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_overrides" ADD CONSTRAINT "access_overrides_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_overrides" ADD CONSTRAINT "access_overrides_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "access_overrides_active_scope_uq" ON "access_overrides" USING btree ("company_id","user_id","permission_id","scope_type",coalesce("scope_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "access_overrides"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "access_overrides_company_idx" ON "access_overrides" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "access_overrides_permission_idx" ON "access_overrides" USING btree ("permission_id");--> statement-breakpoint
CREATE INDEX "access_overrides_expires_at_idx" ON "access_overrides" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "role_permissions_company_idx" ON "role_permissions" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_roles_active_scope_uq" ON "user_roles" USING btree ("company_id","user_id","role_id","scope_type",coalesce("scope_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "user_roles"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "user_roles_company_idx" ON "user_roles" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "user_roles_role_idx" ON "user_roles" USING btree ("role_id");--> statement-breakpoint
ALTER TABLE "access_overrides" ADD CONSTRAINT "access_overrides_effect_check" CHECK ("access_overrides"."effect" IN ('grant', 'deny'));--> statement-breakpoint
ALTER TABLE "access_overrides" ADD CONSTRAINT "access_overrides_scope_type_check" CHECK ("access_overrides"."scope_type" IN ('global', 'company', 'brand', 'outlet', 'department', 'own', 'assigned', 'audit_view'));--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_default_scope_type_check" CHECK ("roles"."default_scope_type" IN ('global', 'company', 'brand', 'outlet', 'department', 'own', 'assigned', 'audit_view'));--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_scope_type_check" CHECK ("user_roles"."scope_type" IN ('global', 'company', 'brand', 'outlet', 'department', 'own', 'assigned', 'audit_view'));