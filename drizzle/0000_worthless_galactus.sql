CREATE TABLE "module_ai_copilot_agent_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"channel" text DEFAULT 'mcp' NOT NULL,
	"profile" text DEFAULT 'readonly' NOT NULL,
	"token_hash" text NOT NULL,
	"token_hint" text NOT NULL,
	"capability_revision" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_ai_copilot_connections_token" ON "module_ai_copilot_agent_connections" USING btree ("token_hash");