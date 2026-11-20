import { authOptions } from "@/lib/auth/auth-options";
import { getServerSession } from "next-auth";

export const getSession = async () => {
  return getServerSession(authOptions);
};
