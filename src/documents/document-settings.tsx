import { Button } from "@/common/ui/button";
import { ConfirmDialog } from "@/common/ui/confirm-dialog";
import { Icon } from "@/common/ui/icon";
import { SettingsPage, SettingsSection } from "@/settings/components/settings-layout";
import { BundledProviderList } from "./components/bundled-provider-list";
import { FileTypeList } from "./components/file-type-list";
import { InstallReviewDialog } from "./components/install-review-dialog";
import { ProviderList } from "./components/provider-list";
import { useProviderSettings } from "./hooks/use-provider-settings";

export function DocumentSettings() {
  const settings = useProviderSettings();
  const { providers, broken } = settings.registry;
  const installed = providers.filter((p) => p.source === "installed");
  const removing =
    settings.removing &&
    (providers.find((p) => p.id === settings.removing)?.name ?? settings.removing);

  return (
    <SettingsPage
      sectioned
      title="Documents"
      description="Files Cairngorm opens in its own panes, and what opens them. Each editor runs isolated and only sees the documents you open with it."
      actions={
        <Button
          size="sm"
          variant="outline"
          onClick={() => void settings.chooseFolder()}
          data-testid="document-provider-install"
        >
          <Icon name="folder-open" class="mr-1.5" />
          Add an editor…
        </Button>
      }
      data-testid="document-settings"
    >
      {settings.error && (
        <p role="alert" class="px-5 pb-3 text-xs text-destructive">
          {settings.error}
        </p>
      )}
      <SettingsSection title="File types">
        <FileTypeList providers={providers} choices={settings.choices} />
      </SettingsSection>
      <SettingsSection title="Editors">
        <ProviderList
          providers={installed}
          broken={broken}
          onRemove={settings.askRemove}
          empty="No editors added. Add one to open more file types inside Cairngorm."
        />
      </SettingsSection>
      <BundledProviderList />
      {settings.review && (
        <InstallReviewDialog
          path={settings.review.path}
          inspection={settings.review.inspection}
          pending={settings.pending}
          onApprove={() => void settings.approve()}
          onCancel={settings.cancelReview}
        />
      )}
      <ConfirmDialog
        open={Boolean(settings.removing)}
        title={`Remove ${removing}?`}
        message="Open panes using it close their view. You can install it again later."
        confirmLabel="Remove"
        pending={settings.pending}
        onConfirm={() => void settings.remove()}
        onCancel={settings.cancelRemove}
      />
    </SettingsPage>
  );
}
