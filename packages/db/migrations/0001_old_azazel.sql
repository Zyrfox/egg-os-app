CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"brand_code" varchar(30) NOT NULL,
	"brand_name" varchar(150) NOT NULL,
	"brand_type" varchar(30) DEFAULT 'business_unit' NOT NULL,
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_code" varchar(30) NOT NULL,
	"company_name" varchar(150) NOT NULL,
	"legal_name" varchar(200),
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"brand_id" uuid,
	"outlet_id" uuid,
	"department_code" varchar(30) NOT NULL,
	"department_name" varchar(150) NOT NULL,
	"department_type" varchar(30) NOT NULL,
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "outlets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"outlet_code" varchar(30) NOT NULL,
	"outlet_name" varchar(150) NOT NULL,
	"outlet_type" varchar(30) DEFAULT 'operational' NOT NULL,
	"address" varchar(500),
	"timezone" varchar(60) DEFAULT 'Asia/Jakarta' NOT NULL,
	"opening_time" time,
	"closing_time" time,
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlets" ADD CONSTRAINT "outlets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlets" ADD CONSTRAINT "outlets_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brands_company_code_uq" ON "brands" USING btree ("company_id","brand_code") WHERE "brands"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "brands_company_idx" ON "brands" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "brands_status_idx" ON "brands" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_company_code_uq" ON "companies" USING btree ("company_code") WHERE "companies"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "companies_status_idx" ON "companies" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "departments_outlet_code_uq" ON "departments" USING btree ("company_id","outlet_id","department_code") WHERE "departments"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "departments_company_idx" ON "departments" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "departments_brand_idx" ON "departments" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "departments_outlet_idx" ON "departments" USING btree ("outlet_id");--> statement-breakpoint
CREATE INDEX "departments_status_idx" ON "departments" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "outlets_brand_code_uq" ON "outlets" USING btree ("brand_id","outlet_code") WHERE "outlets"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "outlets_company_idx" ON "outlets" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "outlets_brand_idx" ON "outlets" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "outlets_status_idx" ON "outlets" USING btree ("status");