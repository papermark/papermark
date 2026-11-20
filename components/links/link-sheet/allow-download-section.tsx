import { useEffect, useState } from "react";

import { DEFAULT_LINK_TYPE } from ".";
import LinkItem from "./link-item";

export default function AllowDownloadSection({
  data,
  setData,
}: {
  data: DEFAULT_LINK_TYPE;
  setData: React.Dispatch<React.SetStateAction<DEFAULT_LINK_TYPE>>;
}) {
  const { allowDownload } = data;
  const [enabled, setEnabled] = useState<boolean>(false);

  useEffect(() => {
    setEnabled(allowDownload);
  }, [allowDownload]);

  const handleAllowDownload = () => {
    const updatedAllowDownload = !enabled;
    setData({ ...data, allowDownload: updatedAllowDownload });
    setEnabled(updatedAllowDownload);
  };

  return (
    <div className="pb-5">
      <LinkItem
        title="Download permissions"
        enabled={enabled}
        link="https://www.papermark.com/help/article/link-settings"
        action={handleAllowDownload}
        tooltipContent="Allow visitors to download the content."
      />
    </div>
  );
}
