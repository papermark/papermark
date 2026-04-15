export const FADE_IN_ANIMATION_SETTINGS = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.2 },
};

export const STAGGER_CHILD_VARIANTS = {
  hidden: { opacity: 0, y: 20 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, type: "spring" as const },
  },
};

export const PAPERMARK_HEADERS = {
  headers: {
    "x-powered-by":
      "Papermark - Secure Data Room Infrastructure for the modern web",
  },
};

export const REACTIONS = [
  {
    emoji: "❤️",
    label: "heart",
  },
  {
    emoji: "💸",
    label: "money",
  },
  {
    emoji: "👍",
    label: "up",
  },
  {
    emoji: "👎",
    label: "down",
  },
];

// time in milliseconds
export const ONE_SECOND = 1000;
export const ONE_MINUTE = ONE_SECOND * 60;
export const TWO_MINUTES = ONE_MINUTE * 2;
export const ONE_HOUR = ONE_MINUTE * 60;
export const ONE_DAY = ONE_HOUR * 24;
export const ONE_WEEK = ONE_DAY * 7;

// growing list of blocked pathnames that lead to 404s
export const BLOCKED_PATHNAMES = [
  "/phpmyadmin",
  "/server-status",
  "/wordpress",
  "/_all_dbs",
  "/wp-json",
];

// list of paths that should be excluded from team checks
export const EXCLUDED_PATHS = ["/", "/register", "/privacy", "/view", "/notification-preferences"];

// free limits
export const LIMITS = {
  views: 20,
};

export const SUPPORTED_DOCUMENT_MIME_TYPES = [
  "application/pdf", // .pdf
  "application/vnd.ms-excel", // .xls
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-excel.sheet.macroEnabled.12", // .xlsm
  "text/csv", // .csv
  "text/tab-separated-values", // .tsv
  "application/vnd.oasis.opendocument.spreadsheet", // .ods
  "application/vnd.ms-powerpoint", // .ppt
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
  "application/vnd.oasis.opendocument.presentation", // .odp
  "application/vnd.apple.keynote", // .key
  "application/x-iwork-keynote-sffkey", // .key (older format)
  "application/msword", // .doc
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.oasis.opendocument.text", // .odt
  "application/rtf", // .rtf
  "text/rtf", // .rtf
  "text/plain", // .txt
  "text/markdown", // .md
  "image/vnd.dwg", // .dwg
  "image/vnd.dxf", // .dxf
  "image/png", // .png
  "image/jpeg", // .jpeg
  "image/jpg", // .jpg
  "application/zip", // .zip
  "application/x-zip-compressed", // .zip
  "video/mp4", // .mp4
  "video/quicktime", // .mov
  "video/x-msvideo", // .avi
  "video/webm", // .webm
  "video/ogg", // .ogg
  "audio/mp4", // .m4a
  "audio/x-m4a", // .m4a (older MIME type)
  "audio/m4a", // .m4a (alternative MIME type)
  "audio/mpeg", // .mp3
  "application/vnd.google-earth.kml+xml", // .kml
  "application/vnd.google-earth.kmz", // .kmz
  "application/vnd.ms-outlook", // .msg
];

// Upload configurations for different plan types and contexts
export const FREE_PLAN_ACCEPTED_FILE_TYPES = {
  "application/pdf": [], // ".pdf"
  "application/vnd.ms-excel": [], // ".xls"
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [], // ".xlsx"
  "text/csv": [], // ".csv"
  "application/vnd.oasis.opendocument.spreadsheet": [], // ".ods"
  "image/png": [], // ".png"
  "image/jpeg": [], // ".jpeg"
  "image/jpg": [], // ".jpg"
};

export const FULL_PLAN_ACCEPTED_FILE_TYPES = {
  "application/pdf": [], // ".pdf"
  "application/vnd.ms-excel": [], // ".xls"
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [], // ".xlsx"
  "application/vnd.ms-excel.sheet.macroEnabled.12": [".xlsm"], // ".xlsm"
  "text/csv": [], // ".csv"
  "text/tab-separated-values": [".tsv"], // ".tsv"
  "application/vnd.oasis.opendocument.spreadsheet": [], // ".ods"
  "application/vnd.ms-powerpoint": [], // ".ppt"
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    [], // ".pptx"
  "application/vnd.oasis.opendocument.presentation": [], // ".odp"
  "application/vnd.apple.keynote": [".key"], // ".key"
  "application/x-iwork-keynote-sffkey": [".key"], // ".key"
  "application/msword": [], // ".doc"
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [], // ".docx"
  "application/vnd.oasis.opendocument.text": [], // ".odt"
  "application/rtf": [], // ".rtf"
  "text/rtf": [], // ".rtf"
  "text/plain": [".txt", ".log"], // ".txt", ".log"
  "image/vnd.dwg": [".dwg"], // ".dwg"
  "image/vnd.dxf": [".dxf"], // ".dxf"
  "image/png": [], // ".png"
  "image/jpeg": [], // ".jpeg"
  "image/jpg": [], // ".jpg"
  "application/zip": [], // ".zip"
  "application/x-zip-compressed": [], // ".zip"
  "video/mp4": [".mp4"], // ".mp4"
  "video/quicktime": [".mov"], // ".mov"
  "video/x-msvideo": [".avi"], // ".avi"
  "video/webm": [".webm"], // ".webm"
  "video/ogg": [".ogg"], // ".ogg"
  "audio/mp4": [".m4a"], // ".m4a"
  "audio/x-m4a": [".m4a"], // ".m4a"
  "audio/m4a": [".m4a"], // ".m4a"
  "audio/mpeg": [".mp3"], // ".mp3"
  "application/vnd.google-earth.kml+xml": [".kml"], // ".kml"
  "application/vnd.google-earth.kmz": [".kmz"], // ".kmz"
  "application/vnd.ms-outlook": [".msg"], // ".msg"
};

export const VIEWER_ACCEPTED_FILE_TYPES = {
  "application/pdf": [], // ".pdf"
  "application/vnd.ms-excel": [], // ".xls"
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [], // ".xlsx"
  "application/vnd.ms-excel.sheet.macroEnabled.12": [".xlsm"], // ".xlsm"
  "text/csv": [], // ".csv"
  "text/tab-separated-values": [".tsv"], // ".tsv"
  "application/vnd.oasis.opendocument.spreadsheet": [], // ".ods"
  "application/vnd.ms-powerpoint": [], // ".ppt"
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    [], // ".pptx"
  "application/vnd.oasis.opendocument.presentation": [], // ".odp"
  "application/vnd.apple.keynote": [".key"], // ".key"
  "application/x-iwork-keynote-sffkey": [".key"], // ".key"
  "application/msword": [], // ".doc"
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [], // ".docx"
  "application/vnd.oasis.opendocument.text": [], // ".odt"
  "application/rtf": [], // ".rtf"
  "text/rtf": [], // ".rtf"
  "text/plain": [".txt", ".log"], // ".txt", ".log"
  "image/png": [], // ".png"
  "image/jpeg": [], // ".jpeg"
  "image/jpg": [], // ".jpg"
  "application/zip": [".zip"], // ".zip"
  "application/x-zip-compressed": [".zip"], // ".zip"
  "application/vnd.ms-outlook": [".msg"], // ".msg"
};

export const SUPPORTED_DOCUMENT_SIMPLE_TYPES = [
  "pdf",
  "notion",
  "link",
  "sheet",
  "slides",
  "docs",
  "cad",
  "image",
  "zip",
  "video",
  "map",
  "email",
] as const;

export const VIDEO_EVENT_TYPES = [
  // Playback events
  "loaded", // Initial load
  "played", // Play pressed
  "seeked", // User seeked to position

  // Speed events
  "rate_changed", // Playback speed changed

  // Volume events
  "volume_up", // Volume increased
  "volume_down", // Volume decreased
  "muted", // Muted
  "unmuted", // Unmuted

  // View state events
  "focus", // Window/tab gained focus
  "blur", // Window/tab lost focus
  "enterfullscreen", // Entered fullscreen
  "exitfullscreen", // Exited fullscreen
] as const;

export const COUNTRIES: { [key: string]: string } = {
  AF: "Afghanistan",
  AL: "Albania",
  DZ: "Algeria",
  AS: "American Samoa",
  AD: "Andorra",
  AO: "Angola",
  AI: "Anguilla",
  AQ: "Antarctica",
  AG: "Antigua and Barbuda",
  AR: "Argentina",
  AM: "Armenia",
  AW: "Aruba",
  AU: "Australia",
  AT: "Austria",
  AZ: "Azerbaijan",
  BS: "Bahamas",
  BH: "Bahrain",
  BD: "Bangladesh",
  BB: "Barbados",
  BY: "Belarus",
  BE: "Belgium",
  BZ: "Belize",
  BJ: "Benin",
  BM: "Bermuda",
  BT: "Bhutan",
  BO: "Bolivia",
  BA: "Bosnia and Herzegovina",
  BW: "Botswana",
  BV: "Bouvet Island",
  BR: "Brazil",
  IO: "British Indian Ocean Territory",
  BN: "Brunei Darussalam",
  BG: "Bulgaria",
  BF: "Burkina Faso",
  BI: "Burundi",
  KH: "Cambodia",
  CM: "Cameroon",
  CA: "Canada",
  CV: "Cape Verde",
  KY: "Cayman Islands",
  CF: "Central African Republic",
  TD: "Chad",
  CL: "Chile",
  CN: "China",
  CX: "Christmas Island",
  CC: "Cocos (Keeling) Islands",
  CO: "Colombia",
  KM: "Comoros",
  CG: "Congo (Republic)",
  CD: "Congo (Democratic Republic)",
  CK: "Cook Islands",
  CR: "Costa Rica",
  CI: "Ivory Coast",
  HR: "Croatia",
  CU: "Cuba",
  CY: "Cyprus",
  CZ: "Czech Republic",
  DK: "Denmark",
  DJ: "Djibouti",
  DM: "Dominica",
  DO: "Dominican Republic",
  EC: "Ecuador",
  EG: "Egypt",
  SV: "El Salvador",
  GQ: "Equatorial Guinea",
  ER: "Eritrea",
  EE: "Estonia",
  ET: "Ethiopia",
  FK: "Falkland Islands",
  FO: "Faroe Islands",
  FJ: "Fiji",
  FI: "Finland",
  FR: "France",
  GF: "French Guiana",
  PF: "French Polynesia",
  TF: "French Southern Territories",
  GA: "Gabon",
  GM: "Gambia",
  GE: "Georgia",
  DE: "Germany",
  GH: "Ghana",
  GI: "Gibraltar",
  GR: "Greece",
  GL: "Greenland",
  GD: "Grenada",
  GP: "Guadeloupe",
  GU: "Guam",
  GT: "Guatemala",
  GN: "Guinea",
  GW: "Guinea-Bissau",
  GY: "Guyana",
  HT: "Haiti",
  HM: "Heard Island and McDonald Islands",
  VA: "Vatican City",
  HN: "Honduras",
  HK: "Hong Kong",
  HU: "Hungary",
  IS: "Iceland",
  IN: "India",
  ID: "Indonesia",
  IR: "Iran",
  IQ: "Iraq",
  IE: "Ireland",
  IL: "Israel",
  IT: "Italy",
  JM: "Jamaica",
  JP: "Japan",
  JO: "Jordan",
  KZ: "Kazakhstan",
  KE: "Kenya",
  KI: "Kiribati",
  KP: "North Korea",
  KR: "South Korea",
  KW: "Kuwait",
  KG: "Kyrgyzstan",
  LA: "Laos",
  LV: "Latvia",
  LB: "Lebanon",
  LS: "Lesotho",
  LR: "Liberia",
  LY: "Libya",
  LI: "Liechtenstein",
  LT: "Lithuania",
  LU: "Luxembourg",
  MO: "Macao",
  MG: "Madagascar",
  MW: "Malawi",
  MY: "Malaysia",
  MV: "Maldives",
  ML: "Mali",
  MT: "Malta",
  MH: "Marshall Islands",
  MQ: "Martinique",
  MR: "Mauritania",
  MU: "Mauritius",
  YT: "Mayotte",
  MX: "Mexico",
  FM: "Micronesia",
  MD: "Moldova",
  MC: "Monaco",
  MN: "Mongolia",
  MS: "Montserrat",
  MA: "Morocco",
  MZ: "Mozambique",
  MM: "Myanmar",
  NA: "Namibia",
  NR: "Nauru",
  NP: "Nepal",
  NL: "Netherlands",
  NC: "New Caledonia",
  NZ: "New Zealand",
  NI: "Nicaragua",
  NE: "Niger",
  NG: "Nigeria",
  NU: "Niue",
  NF: "Norfolk Island",
  MK: "Macedonia",
  MP: "Northern Mariana Islands",
  NO: "Norway",
  OM: "Oman",
  PK: "Pakistan",
  PW: "Palau",
  PS: "Palestine",
  PA: "Panama",
  PG: "Papua New Guinea",
  PY: "Paraguay",
  PE: "Peru",
  PH: "Philippines",
  PN: "Pitcairn",
  PL: "Poland",
  PT: "Portugal",
  PR: "Puerto Rico",
  QA: "Qatar",
  RE: "Reunion",
  RO: "Romania",
  RU: "Russia",
  RW: "Rwanda",
  SH: "Saint Helena",
  KN: "Saint Kitts and Nevis",
  LC: "Saint Lucia",
  PM: "Saint Pierre and Miquelon",
  VC: "Saint Vincent and the Grenadines",
  WS: "Samoa",
  SM: "San Marino",
  ST: "Sao Tome and Principe",
  SA: "Saudi Arabia",
  SN: "Senegal",
  SC: "Seychelles",
  SL: "Sierra Leone",
  SG: "Singapore",
  SK: "Slovakia",
  SI: "Slovenia",
  SB: "Solomon Islands",
  SO: "Somalia",
  ZA: "South Africa",
  GS: "South Georgia and the South Sandwich Islands",
  ES: "Spain",
  LK: "Sri Lanka",
  SD: "Sudan",
  SR: "Suriname",
  SJ: "Svalbard and Jan Mayen",
  SZ: "Eswatini",
  SE: "Sweden",
  CH: "Switzerland",
  SY: "Syrian Arab Republic",
  TW: "Taiwan",
  TJ: "Tajikistan",
  TZ: "Tanzania",
  TH: "Thailand",
  TL: "Timor-Leste",
  TG: "Togo",
  TK: "Tokelau",
  TO: "Tonga",
  TT: "Trinidad and Tobago",
  TN: "Tunisia",
  TR: "Turkey",
  TM: "Turkmenistan",
  TC: "Turks and Caicos Islands",
  TV: "Tuvalu",
  UG: "Uganda",
  UA: "Ukraine",
  AE: "United Arab Emirates",
  GB: "United Kingdom",
  US: "United States",
  UM: "United States Minor Outlying Islands",
  UY: "Uruguay",
  UZ: "Uzbekistan",
  VU: "Vanuatu",
  VE: "Venezuela",
  VN: "Vietnam",
  VG: "Virgin Islands, British",
  VI: "Virgin Islands, U.S.",
  WF: "Wallis and Futuna",
  EH: "Western Sahara",
  YE: "Yemen",
  ZM: "Zambia",
  ZW: "Zimbabwe",
  AX: "Åland Islands",
  BQ: "Bonaire, Sint Eustatius and Saba",
  CW: "Curaçao",
  GG: "Guernsey",
  IM: "Isle of Man",
  JE: "Jersey",
  ME: "Montenegro",
  BL: "Saint Barthélemy",
  MF: "Saint Martin (French part)",
  RS: "Serbia",
  SX: "Sint Maarten (Dutch part)",
  SS: "South Sudan",
  XK: "Kosovo",
};

export const COUNTRY_CODES = Object.keys(COUNTRIES) as [string, ...string[]];

export const EU_COUNTRY_CODES = [
  "AT",
  "BE",
  "BG",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "ES",
  "FI",
  "FR",
  "GB",
  "GR",
  "HR",
  "HU",
  "IE",
  "IS",
  "IT",
  "LI",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "NO",
  "PL",
  "PT",
  "RO",
  "SE",
  "SI",
  "SK",
];

export const SYSTEM_FILES = [".DS_Store", "Thumbs.db", "node_modules"];
