// INFO: for numeric values,`null` means unlimited

export type TFileSizeLimits = {
  video?: number | null;
  document?: number | null;
  image?: number | null;
  excel?: number | null;
  maxFiles?: number | null;
  maxPages?: number | null;
};

export type TPlanLimits = {
  users: number | null;
  links: number | null;
  documents: number | null;
  domains: number | null;
  datarooms: number | null;
  customDomainOnPro: boolean;
  customDomainInDataroom: boolean;
  advancedLinkControlsOnPro: boolean | null;
  watermarkOnBusiness?: boolean | null;
  agreementOnBusiness?: boolean | null;
  linkCustomFields?: number | null;
  conversationsInDataroom?: boolean;
  fileSizeLimits?: TFileSizeLimits;
};

export const FREE_PLAN_LIMITS = {
  users: 1,
  links: 50,
  documents: 50,
  domains: 0,
  datarooms: 0,
  customDomainOnPro: false,
  customDomainInDataroom: false,
  advancedLinkControlsOnPro: false,
  linkCustomFields: 0,
};

export const PRO_PLAN_LIMITS = {
  users: 1,
  links: null,
  documents: 300,
  domains: 0,
  datarooms: 0,
  customDomainOnPro: false,
  customDomainInDataroom: false,
  advancedLinkControlsOnPro: false,
  linkCustomFields: 0,
};

export const BUSINESS_PLAN_LIMITS = {
  users: 3,
  links: null,
  documents: null,
  domains: 5,
  datarooms: 100,
  customDomainOnPro: true,
  customDomainInDataroom: false,
  advancedLinkControlsOnPro: false,
  linkCustomFields: 1,
  fileSizeLimits: {
    maxFiles: 500,
  },
};

export const DATAROOMS_PLAN_LIMITS = {
  users: 3,
  links: null,
  documents: null,
  domains: 10,
  datarooms: 100,
  customDomainOnPro: true,
  customDomainInDataroom: true,
  advancedLinkControlsOnPro: false,
  linkCustomFields: 5,
  fileSizeLimits: {
    maxFiles: 1000,
  },
};

export const DATAROOMS_PLUS_PLAN_LIMITS = {
  users: 5,
  links: null,
  documents: null,
  domains: 1000,
  datarooms: 1000,
  customDomainOnPro: true,
  customDomainInDataroom: true,
  conversationsInDataroom: true,
  advancedLinkControlsOnPro: false,
  linkCustomFields: 5,
  fileSizeLimits: {
    maxFiles: 5000,
    maxPages: 1000,
  },
};

export const DATAROOMS_PREMIUM_PLAN_LIMITS = {
  users: 10,
  links: null,
  documents: null,
  domains: 1000,
  datarooms: 1000,
  customDomainOnPro: true,
  customDomainInDataroom: true,
  conversationsInDataroom: true,
  advancedLinkControlsOnPro: false,
  linkCustomFields: 5,
  fileSizeLimits: {
    maxFiles: 5000,
    maxPages: 1000,
  },
};

export const DATAROOMS_UNLIMITED_PLAN_LIMITS = {
  users: null,
  links: null,
  documents: null,
  domains: null,
  datarooms: null,
  customDomainOnPro: true,
  customDomainInDataroom: true,
  conversationsInDataroom: true,
  advancedLinkControlsOnPro: false,
  linkCustomFields: 5,
  fileSizeLimits: {
    maxFiles: null,
    maxPages: null,
  },
};

export const PAUSED_PLAN_LIMITS = {
  // During pause: keep all data accessible but restrict new creations and views
  canCreateLinks: false,
  canReceiveViews: false,
  canCreateDocuments: false,
  canCreateDatarooms: false,
  // Keep existing access
  canViewAnalytics: true,
  canAccessExistingContent: true,
};
