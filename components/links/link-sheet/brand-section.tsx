import {
  CUSTOM_DATAROOM_BRAND,
  CUSTOM_DATAROOM_BRAND_LABEL,
} from "@/ee/features/branding/lib/resolve-dataroom-displayed-brand";
import { LinkType } from "@prisma/client";

import { useBrands, useDataroomBrand } from "@/lib/swr/use-brand";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { DEFAULT_LINK_TYPE } from ".";

const INHERIT_TEAM_DEFAULT = "inherit-team-default";

function BrandOptionLabel({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2 overflow-hidden">
      <span className="truncate">{title}</span>
      <span className="min-w-0 truncate text-xs font-normal text-muted-foreground">
        {subtitle}
      </span>
    </span>
  );
}

export function BrandSection({
  data,
  setData,
  linkType,
  dataroomId,
}: {
  data: DEFAULT_LINK_TYPE;
  setData: React.Dispatch<React.SetStateAction<DEFAULT_LINK_TYPE>>;
  linkType: Omit<LinkType, "WORKFLOW_LINK">;
  dataroomId?: string;
}) {
  const { brands, defaultBrandId } = useBrands();
  const isDataroomLink = linkType === "DATAROOM_LINK" || Boolean(dataroomId);
  const {
    dataroomBrandId: fetchedDataroomBrandId,
    loading: dataroomBrandLoading,
  } = useDataroomBrand({
    dataroomId: isDataroomLink ? dataroomId : undefined,
  });

  if (brands.length === 0) {
    return null;
  }
  if (!isDataroomLink && brands.length <= 1) {
    return null;
  }

  const teamDefaultId = defaultBrandId ?? brands[0]?.id ?? null;
  const defaultTeamBrandName =
    brands.find((brand) => brand.id === teamDefaultId)?.name ?? "Default";
  const dataroomTeamBrandId = dataroomBrandLoading
    ? data.dataroomBrandId
    : fetchedDataroomBrandId !== undefined
      ? fetchedDataroomBrandId
      : data.dataroomBrandId;
  const currentDataroomBrandName =
    typeof dataroomTeamBrandId === "string" && dataroomTeamBrandId.length > 0
      ? (brands.find((brand) => brand.id === dataroomTeamBrandId)?.name ??
        CUSTOM_DATAROOM_BRAND_LABEL)
      : CUSTOM_DATAROOM_BRAND_LABEL;

  const selectedValue = (() => {
    if (data.brandId == null) {
      return isDataroomLink ? CUSTOM_DATAROOM_BRAND : INHERIT_TEAM_DEFAULT;
    }
    if (isDataroomLink && data.brandId === teamDefaultId) {
      return INHERIT_TEAM_DEFAULT;
    }
    return data.brandId;
  })();

  return (
    <div className="pb-3">
      <div className="flex items-center justify-between gap-x-2">
        <Label
          htmlFor="link-team-brand"
          className="text-sm font-medium leading-6"
        >
          Link brand
        </Label>
        <Select
          value={selectedValue}
          onValueChange={(value) => {
            if (value === CUSTOM_DATAROOM_BRAND) {
              setData({ ...data, brandId: null });
              return;
            }
            if (value === INHERIT_TEAM_DEFAULT) {
              setData({
                ...data,
                brandId: isDataroomLink ? teamDefaultId : null,
              });
              return;
            }
            setData({ ...data, brandId: value });
          }}
        >
          <SelectTrigger
            id="link-team-brand"
            className="w-64 [&>span]:min-w-0 [&>span]:truncate"
          >
            <SelectValue placeholder="Inherit team default" />
          </SelectTrigger>
          <SelectContent align="end">
            {isDataroomLink ? (
              <>
                <SelectItem value={CUSTOM_DATAROOM_BRAND}>
                  <BrandOptionLabel
                    title="Dataroom brand"
                    subtitle={currentDataroomBrandName}
                  />
                </SelectItem>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel className="text-xs font-normal text-muted-foreground">
                    Team brands
                  </SelectLabel>
                  <SelectItem value={INHERIT_TEAM_DEFAULT}>
                    <BrandOptionLabel
                      title={defaultTeamBrandName}
                      subtitle="Team default"
                    />
                  </SelectItem>
                  {brands.map((brand) => (
                    <SelectItem key={brand.id} value={brand.id}>
                      <span className="block truncate">{brand.name}</span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              </>
            ) : (
              <>
                <SelectItem value={INHERIT_TEAM_DEFAULT}>
                  <BrandOptionLabel
                    title="Inherit team default"
                    subtitle={defaultTeamBrandName}
                  />
                </SelectItem>
                {brands.map((brand) => (
                  <SelectItem key={brand.id} value={brand.id} className="pr-16">
                    <span className="block truncate">{brand.name}</span>
                  </SelectItem>
                ))}
              </>
            )}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
