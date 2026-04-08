import Link from "next/link";
import { useRouter } from "next/router";

import { useEffect } from "react";

import { useTeam } from "@/context/team-context";
import {
  DirectorySyncConfigModal,
  SAMLConfigModal,
  SSOEnforcementToggle,
} from "@/ee/features/security/sso";
import { FolderSync, Info, Shield } from "lucide-react";

import { useFeatureFlags } from "@/lib/hooks/use-feature-flags";
import { useIsAdmin } from "@/lib/hooks/use-is-admin";

import AppLayout from "@/components/layouts/app";
import { SettingsHeader } from "@/components/settings/settings-header";

const SSO_ELIGIBLE_PLANS = ["datarooms-premium", "datarooms-premium+old", "datarooms-unlimited", "datarooms-unlimited+old"];

export default function SecuritySettings() {
  const router = useRouter();
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;
  const teamPlan = teamInfo?.currentTeam?.plan;
  const { isFeatureEnabled } = useFeatureFlags();
  const { isAdmin, loading: isAdminLoading } = useIsAdmin();

  // Redirect non-admin users to general settings
  useEffect(() => {
    if (!isAdminLoading && !isAdmin) {
      router.replace("/settings/general");
    }
  }, [isAdmin, isAdminLoading, router]);

  // Show nothing while checking admin status
  if (isAdminLoading || !isAdmin) {
    return (
      <AppLayout>
        <div />
      </AppLayout>
    );
  }

  const isSSOFeatureEnabled = isFeatureEnabled("sso");
  const isPlanEligible = teamPlan
    ? SSO_ELIGIBLE_PLANS.includes(teamPlan)
    : false;
  const canAccessSSO = isSSOFeatureEnabled && isPlanEligible;

  return (
    <AppLayout>
      <main className="relative mx-2 mb-10 mt-4 space-y-8 overflow-hidden px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
        <SettingsHeader />

        {!canAccessSSO ? (
          <div className="rounded-lg border border-muted p-6 sm:p-10">
            <div className="flex items-start space-x-3">
              <Shield className="mt-0.5 h-5 w-5 text-muted-foreground" />
              <div className="space-y-1">
                <h2 className="text-xl font-medium">
                  SAML SSO &amp; SCIM Directory Sync
                </h2>
                <p className="text-sm text-muted-foreground">
                  Enterprise security features including SAML Single Sign-On and
                  SCIM directory sync are available as an add-on on the
                  Datarooms Premium or Unlimited plan.
                </p>
                {!isPlanEligible && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    <Link
                      href="/settings/billing"
                      className="font-medium underline"
                    >
                      Upgrade to Datarooms Premium or Unlimited
                    </Link>{" "}
                    to add SSO for your team.
                  </p>
                )}
                {isPlanEligible && !isSSOFeatureEnabled && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    SSO is not yet enabled for your team. Please contact support
                    to enable it.
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* SAML SSO Section */}
            <div className="rounded-lg border border-muted p-6 sm:p-10">
              <div className="space-y-6">
                <div className="flex items-start space-x-3">
                  <Shield className="mt-0.5 h-5 w-5 text-muted-foreground" />
                  <div className="space-y-1">
                    <h2 className="text-xl font-medium">
                      SAML Single Sign-On (SSO)
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Allow team members to sign in using your
                      organization&apos;s Identity Provider (IdP) such as
                      Microsoft Entra ID, Okta, or Google Workspace.
                    </p>
                  </div>
                </div>

                {teamId ? (
                  <SAMLConfigModal teamId={teamId} />
                ) : (
                  <div className="text-sm text-muted-foreground">
                    Select a team to manage SAML SSO settings.
                  </div>
                )}

                {/* SSO Enforcement Toggle */}
                {teamId && <SSOEnforcementToggle teamId={teamId} />}

                <div className="flex items-start space-x-2 rounded-md border bg-muted/30 p-3">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="text-xs text-muted-foreground">
                    <p className="font-medium">
                      Setting up SAML SSO with Microsoft Entra ID:
                    </p>
                    <ol className="mt-1 list-inside list-decimal space-y-1">
                      <li>Create an Enterprise Application in Azure Portal</li>
                      <li>
                        Configure Single Sign-On &rarr; SAML with the Entity ID
                        and ACS URL shown above
                      </li>
                      <li>
                        Copy the App Federation Metadata URL from SAML
                        Certificates
                      </li>
                      <li>Paste it in the configuration dialog above</li>
                      <li>Assign users and groups to the application</li>
                    </ol>
                  </div>
                </div>
              </div>
            </div>

            {/* Directory Sync Section */}
            <div className="rounded-lg border border-muted p-6 sm:p-10">
              <div className="space-y-6">
                <div className="flex items-start space-x-3">
                  <FolderSync className="mt-0.5 h-5 w-5 text-muted-foreground" />
                  <div className="space-y-1">
                    <h2 className="text-xl font-medium">SCIM Directory Sync</h2>
                    <p className="text-sm text-muted-foreground">
                      Automatically provision and deprovision team members from
                      your Identity Provider. When users are added or removed in
                      your IdP, they&apos;ll be automatically synced to this
                      team.
                    </p>
                  </div>
                </div>

                {teamId ? (
                  <DirectorySyncConfigModal teamId={teamId} />
                ) : (
                  <div className="text-sm text-muted-foreground">
                    Select a team to manage Directory Sync settings.
                  </div>
                )}

                <div className="flex items-start space-x-2 rounded-md border bg-muted/30 p-3">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="text-xs text-muted-foreground">
                    <p className="font-medium">
                      Setting up SCIM with Microsoft Entra ID:
                    </p>
                    <ol className="mt-1 list-inside list-decimal space-y-1">
                      <li>
                        Create a directory sync connection above to get
                        credentials
                      </li>
                      <li>
                        In Azure Portal &rarr; Enterprise Application &rarr;
                        Provisioning
                      </li>
                      <li>Set Provisioning Mode to &quot;Automatic&quot;</li>
                      <li>
                        Paste the SCIM Base URL as Tenant URL and Bearer Token
                        as Secret Token
                      </li>
                      <li>
                        Click &quot;Test Connection&quot; to verify, then Save
                      </li>
                      <li>
                        Turn provisioning Status to &quot;On&quot; and assign
                        users
                      </li>
                    </ol>
                    <p className="mt-2 italic">
                      Note: Azure SCIM provisioning can take 20-40 minutes for
                      the initial sync cycle.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </AppLayout>
  );
}
