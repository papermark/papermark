import {
  Body,
  Head,
  Html,
  Link,
  Tailwind,
  Text,
} from "@react-email/components";

// Map trigger names to feature titles
const FEATURE_NAMES: Record<string, string> = {
  // Custom domains
  add_domain_overview: "Custom Domains",
  add_domain_link_sheet: "Custom Domains",
  // Data rooms
  datarooms: "Secure Data Rooms",
  add_dataroom_overview: "Secure Data Rooms",
  datarooms_generate_index_button: "Data Room Index",
  datarooms_rebuild_index_button: "Data Room Index",
  // Team features
  invite_team_members: "Team Collaboration",
  add_new_team: "Multiple Teams",
  // Visitor analytics
  "visitor-table-user-agent": "Visitor Analytics",
  // Tags
  create_tag: "Document Tags",
  // Folders
  add_folder_button: "Folders",
  // Document limits
  limit_upload_documents: "Unlimited Documents",
  limit_upload_document_version: "Document Versions",
  // Link limits
  limit_add_link: "Unlimited Links",
  // Analytics exports
  dashboard_visitors_export: "Analytics Export",
  dashboard_views_export: "Analytics Export",
  dashboard_links_export: "Analytics Export",
  dashboard_documents_export: "Analytics Export",
  dashboard_time_range_custom_select: "Custom Date Ranges",
  // Branding
  pro_banner: "Custom Branding",
  // Web links
  add_web_link_document: "Web Links",
  // Groups
  add_group_link: "Link Groups",
};

// Get unique feature names from triggers (deduplicated, lowercase)
function getUniqueFeatureNames(triggers: string[]): string[] {
  const seenTitles = new Set<string>();
  const featureNames: string[] = [];

  for (const trigger of triggers) {
    const title = FEATURE_NAMES[trigger];
    if (title && !seenTitles.has(title)) {
      seenTitles.add(title);
      featureNames.push(title.toLowerCase());
    }
  }

  return featureNames.slice(0, 3); // Max 3 features
}

// Format feature names into a sentence (e.g., "secure data rooms, custom domains and team collaboration")
function formatFeatureList(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

interface UpgradeIntentEmailProps {
  name: string | null | undefined;
  triggers?: string[];
}

const UpgradeIntentEmail = ({ name, triggers = [] }: UpgradeIntentEmailProps) => {
  const featureNames = getUniqueFeatureNames(triggers);
  const hasFeatures = featureNames.length > 0;
  const featureList = formatFeatureList(featureNames);

  return (
    <Html>
      <Head />
      <Tailwind>
        <Body className="font-sans text-sm">
          <Text>Hi{name && ` ${name}`},</Text>
          <Text>
            I noticed you&apos;ve been exploring our upgrade options.
            {hasFeatures &&
              ` I am happy to share more about Papermark ${featureList}.`}
          </Text>
          <Text>
            Is there anything holding you back or any questions I can help
            answer?
          </Text>
          <Text>
            <Link
              href="https://app.papermark.com/settings/upgrade"
              target="_blank"
              className="text-blue-500 underline"
            >
              View upgrade options →
            </Link>
          </Text>
          <Text>Just reply to this email and I&apos;ll get back to you.</Text>
          <Text>
            Best,
            <br />
            Marc
          </Text>
        </Body>
      </Tailwind>
    </Html>
  );
};

export default UpgradeIntentEmail;
