CREATE TABLE "mutation_operations" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"response_status" integer NOT NULL,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
