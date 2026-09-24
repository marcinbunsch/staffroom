import type { IntegrationRow } from "../../../lib/api.ts"

/**
 * The hosted MCP servers we already know the URL of, so adding one is picking a
 * name instead of typing an endpoint. A preset only fills the add-toolset form
 * (name, slug, URL, and the integration that authorizes it) — nothing is saved
 * until the operator hits Add, and every field stays editable.
 *
 * The Google entries are the global endpoints from Google's supported-products
 * list (docs.cloud.google.com/mcp/supported-products). Servers that are regional
 * only (Audit Manager, Security Operations, Composer, Apigee API hub…) or that
 * need a toolset in the path (Gemini Enterprise Agent Platform) are left out —
 * their URLs need a region or toolset filled in, which is what "Custom server"
 * is for.
 */
export interface McpPreset {
  /** The toolset slug (grant key) the preset fills in; unique across presets. */
  slug: string
  /** The toolset name, and the label in the picker. */
  label: string
  url: string
  /** The integration type whose first instance authorizes this server. */
  integrationType: string
  /** The picker group the preset is listed under. */
  group: string
}

const OBSERVABILITY = "Google Cloud — Observability"
const ANALYTICS = "Google Cloud — Data & analytics"
const DATABASES = "Google Cloud — Databases"
const COMPUTE = "Google Cloud — Compute"
const STORAGE = "Google Cloud — Storage"
const PLATFORM = "Google Cloud — Platform & governance"
const WORKSPACE = "Google Workspace"
const APPS = "Apps"

export const MCP_PRESETS: McpPreset[] = [
  cloud(OBSERVABILITY, "cloud-logging", "Cloud Logging", "https://logging.googleapis.com/mcp"),
  cloud(
    OBSERVABILITY,
    "cloud-monitoring",
    "Cloud Monitoring",
    "https://monitoring.googleapis.com/mcp",
  ),
  cloud(OBSERVABILITY, "cloud-trace", "Cloud Trace", "https://cloudtrace.googleapis.com/mcp"),
  cloud(
    OBSERVABILITY,
    "error-reporting",
    "Error Reporting",
    "https://clouderrorreporting.googleapis.com/mcp",
  ),
  cloud(
    OBSERVABILITY,
    "service-health",
    "Personalized Service Health",
    "https://servicehealth.googleapis.com/mcp",
  ),

  cloud(ANALYTICS, "bigquery", "BigQuery", "https://bigquery.googleapis.com/mcp"),
  cloud(
    ANALYTICS,
    "bigquery-data-transfer",
    "BigQuery Data Transfer",
    "https://bigquerydatatransfer.googleapis.com/mcp",
  ),
  cloud(
    ANALYTICS,
    "bigquery-migration",
    "BigQuery Migration",
    "https://bigquerymigration.googleapis.com/mcp",
  ),
  cloud(ANALYTICS, "dataform", "Dataform", "https://dataform.googleapis.com/mcp"),
  cloud(ANALYTICS, "datastream", "Datastream", "https://datastream.googleapis.com/mcp"),
  cloud(ANALYTICS, "data-lineage", "Data lineage", "https://datalineage.googleapis.com/mcp"),
  cloud(
    ANALYTICS,
    "dataplex",
    "Knowledge Catalog (Dataplex)",
    "https://dataplex.googleapis.com/mcp",
  ),
  cloud(
    ANALYTICS,
    "managed-kafka",
    "Managed Service for Apache Kafka",
    "https://managedkafka.googleapis.com/mcp",
  ),
  cloud(
    ANALYTICS,
    "dataproc",
    "Managed Service for Apache Spark",
    "https://dataproc.googleapis.com/mcp",
  ),
  cloud(ANALYTICS, "pubsub", "Pub/Sub", "https://pubsub.googleapis.com/mcp"),

  cloud(DATABASES, "alloydb", "AlloyDB for PostgreSQL", "https://alloydb.googleapis.com/mcp"),
  cloud(DATABASES, "bigtable", "Bigtable", "https://bigtableadmin.googleapis.com/mcp"),
  cloud(DATABASES, "cloud-sql", "Cloud SQL", "https://sqladmin.googleapis.com/mcp"),
  cloud(DATABASES, "firestore", "Firestore", "https://firestore.googleapis.com/mcp"),
  cloud(DATABASES, "spanner", "Spanner", "https://spanner.googleapis.com/mcp"),
  cloud(
    DATABASES,
    "memorystore-redis",
    "Memorystore for Redis",
    "https://redis.googleapis.com/mcp",
  ),
  cloud(
    DATABASES,
    "memorystore-valkey",
    "Memorystore for Valkey",
    "https://memorystore.googleapis.com/mcp",
  ),
  cloud(
    DATABASES,
    "oracle-database",
    "Oracle Database@Google Cloud",
    "https://oracledatabase.googleapis.com/mcp",
  ),
  cloud(
    DATABASES,
    "database-center",
    "Database Center",
    "https://databasecenter.googleapis.com/mcp",
  ),
  cloud(
    DATABASES,
    "database-insights",
    "Database Insights",
    "https://databaseinsights.googleapis.com/mcp",
  ),
  cloud(
    DATABASES,
    "database-migration",
    "Database Migration Service",
    "https://datamigration.googleapis.com/mcp",
  ),
  cloud(
    DATABASES,
    "firebase-data-connect",
    "Firebase SQL Connect",
    "https://firebasedataconnect.googleapis.com/mcp",
  ),

  cloud(COMPUTE, "cloud-run", "Cloud Run", "https://run.googleapis.com/mcp"),
  cloud(COMPUTE, "compute-engine", "Compute Engine", "https://compute.googleapis.com/mcp"),
  cloud(COMPUTE, "gke", "GKE", "https://container.googleapis.com/mcp"),
  cloud(
    COMPUTE,
    "gke-read-only",
    "GKE (read-only)",
    "https://container.googleapis.com/mcp/read-only",
  ),

  cloud(STORAGE, "cloud-storage", "Cloud Storage", "https://storage.googleapis.com/storage/mcp"),
  cloud(STORAGE, "filestore", "Filestore", "https://file.googleapis.com/mcp"),
  cloud(STORAGE, "netapp-volumes", "NetApp Volumes", "https://netapp.googleapis.com/mcp"),
  cloud(STORAGE, "backup-dr", "Backup and DR", "https://backupdr.googleapis.com/mcp"),

  cloud(PLATFORM, "cloud-cli", "Cloud CLI (gcloud)", "https://cloudcli.googleapis.com/mcp"),
  cloud(
    PLATFORM,
    "cloud-asset-inventory",
    "Cloud Asset Inventory",
    "https://cloudasset.googleapis.com/mcp",
  ),
  cloud(
    PLATFORM,
    "resource-manager",
    "Resource Manager",
    "https://cloudresourcemanager.googleapis.com/mcp",
  ),
  cloud(PLATFORM, "iam", "Identity and Access Management", "https://iam.googleapis.com/mcp"),
  cloud(PLATFORM, "cloud-billing", "Cloud Billing", "https://cloudbilling.googleapis.com/mcp"),
  cloud(PLATFORM, "cloud-quotas", "Cloud Quotas", "https://cloudquotas.googleapis.com/mcp"),
  cloud(PLATFORM, "cloud-support", "Cloud Support", "https://cloudsupport.googleapis.com/mcp"),
  cloud(PLATFORM, "recommender", "Recommender", "https://recommender.googleapis.com/mcp"),
  cloud(PLATFORM, "policy-assist", "Policy Assist", "https://policyassist.googleapis.com/mcp"),
  cloud(
    PLATFORM,
    "policy-troubleshooter",
    "Policy Troubleshooter",
    "https://policytroubleshooter.googleapis.com/mcp",
  ),
  cloud(
    PLATFORM,
    "network-intelligence",
    "Network Intelligence Center",
    "https://networkmanagement.googleapis.com/mcp",
  ),
  cloud(
    PLATFORM,
    "cloud-location-finder",
    "Cloud Location Finder",
    "https://cloudlocationfinder.googleapis.com/mcp",
  ),
  cloud(PLATFORM, "maintenance", "Unified Maintenance", "https://maintenance.googleapis.com/mcp"),
  cloud(
    PLATFORM,
    "gemini-cloud-assist",
    "Gemini Cloud Assist",
    "https://geminicloudassist.googleapis.com/mcp",
  ),
  cloud(PLATFORM, "agent-registry", "Agent Registry", "https://agentregistry.googleapis.com/mcp"),
  cloud(PLATFORM, "agent-search", "Agent Search", "https://discoveryengine.googleapis.com/mcp"),
  cloud(
    PLATFORM,
    "app-lifecycle-manager",
    "App Lifecycle Manager",
    "https://saasservicemgmt.googleapis.com/mcp",
  ),

  workspace("gmail", "Gmail", "https://gmailmcp.googleapis.com/mcp/v1"),
  workspace("google-calendar", "Google Calendar", "https://calendarmcp.googleapis.com/mcp/v1"),
  workspace("google-drive", "Google Drive", "https://drivemcp.googleapis.com/mcp/v1"),
  workspace("google-docs", "Google Docs", "https://docsmcp.googleapis.com/mcp/v1"),
  workspace("google-sheets", "Google Sheets", "https://sheetsmcp.googleapis.com/mcp/v1"),
  workspace("google-slides", "Google Slides", "https://slidesmcp.googleapis.com/mcp/v1"),
  workspace("google-chat", "Google Chat", "https://chatmcp.googleapis.com/mcp/v1"),
  workspace("google-contacts", "Google Contacts (People)", "https://people.googleapis.com/mcp/v1"),

  app("slack", "Slack", "https://mcp.slack.com/mcp", "slack"),
  app("github", "GitHub", "https://api.githubcopilot.com/mcp", "github"),
  app("notion", "Notion", "https://mcp.notion.com/mcp", "notion"),
  app("sentry", "Sentry", "https://mcp.sentry.dev/mcp", "sentry"),
  app("linear", "Linear", "https://mcp.linear.app/mcp", "linear"),
  app("hubspot", "HubSpot", "https://mcp.hubspot.com", "hubspot"),
  app("firecrawl", "Firecrawl", "https://mcp.firecrawl.dev/v2/mcp", "firecrawl"),
]

/** The groups in picker order, each with its presets. */
export function presetGroups(): { group: string; presets: McpPreset[] }[] {
  const groups: { group: string; presets: McpPreset[] }[] = []
  for (const preset of MCP_PRESETS) {
    const found = groups.find((g) => g.group === preset.group)
    if (found) found.presets.push(preset)
    else groups.push({ group: preset.group, presets: [preset] })
  }
  return groups
}

/**
 * The form values a preset fills in. The integration is the first instance of
 * the preset's type — most orgs have one; with none configured it is left empty
 * so the operator picks (or goes and adds) one.
 */
export function presetValues(preset: McpPreset, integrations: IntegrationRow[]) {
  return {
    label: preset.label,
    name: preset.slug,
    url: preset.url,
    integration: integrations.find((i) => i.type === preset.integrationType)?.name ?? "",
  }
}

/** A Google Cloud server — authorized by a Google Cloud service account. */
function cloud(group: string, slug: string, label: string, url: string): McpPreset {
  return { slug, label, url, integrationType: "gcp", group }
}

/** A Workspace server — authorized by a Google Workspace OAuth app, per user. */
function workspace(slug: string, label: string, url: string): McpPreset {
  return { slug, label, url, integrationType: "google", group: WORKSPACE }
}

function app(slug: string, label: string, url: string, integrationType: string): McpPreset {
  return { slug, label, url, integrationType, group: APPS }
}
