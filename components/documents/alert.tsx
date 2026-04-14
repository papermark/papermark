import { AlertCircleIcon } from "lucide-react";

import {
  Alert,
  AlertClose,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";

interface AlertProps {
  id: string;
  variant: "default" | "destructive";
  title: string;
  description: React.ReactNode;
  onClose?: () => void;
  className?: string;
  iconClassName?: string;
}

const AlertBanner: React.FC<AlertProps> = ({
  id,
  variant,
  title,
  description,
  onClose,
  className,
  iconClassName,
}) => {
  return (
    <Alert id={id} variant={variant} className={className}>
      <AlertCircleIcon className={iconClassName || "h-4 w-4"} />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
      <AlertClose onClick={onClose} />
    </Alert>
  );
};

export default AlertBanner;
