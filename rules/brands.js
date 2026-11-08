// Companies scammers commonly impersonate, with their real domains.
// `names` are matched case-sensitively in page titles and text.
// `key` is used for lookalike-domain detection (keep it 4+ letters).
// Add employers your users care about — this list is the easiest thing to extend.
export const BRANDS = [
  { names: ["Deloitte"], key: "deloitte", domains: ["deloitte.com"] },
  { names: ["Amazon"], key: "amazon", domains: ["amazon.com", "amazon.jobs", "amazon.science", "aboutamazon.com"] },
  { names: ["Google"], key: "google", domains: ["google.com", "careers.google.com", "withgoogle.com"] },
  { names: ["Microsoft"], key: "microsoft", domains: ["microsoft.com", "microsoftonline.com", "office.com", "live.com"] },
  { names: ["Meta", "Facebook"], key: "facebook", domains: ["meta.com", "metacareers.com", "facebook.com"] },
  { names: ["Apple Inc", "Apple"], key: "apple", domains: ["apple.com"] },
  { names: ["PwC", "PricewaterhouseCoopers"], key: "pricewaterhouse", domains: ["pwc.com"] },
  { names: ["KPMG"], key: "kpmg", domains: ["kpmg.com", "kpmg.us"] },
  { names: ["Ernst & Young", "EY"], key: "ernstyoung", domains: ["ey.com"] },
  { names: ["Accenture"], key: "accenture", domains: ["accenture.com"] },
  { names: ["IBM"], key: "ibm", domains: ["ibm.com"] },
  { names: ["Bank of America"], key: "bankofamerica", domains: ["bankofamerica.com", "bofa.com"] },
  { names: ["Wells Fargo"], key: "wellsfargo", domains: ["wellsfargo.com", "wf.com"] },
  { names: ["JPMorgan", "JPMorgan Chase", "Chase"], key: "jpmorgan", domains: ["jpmorgan.com", "jpmorganchase.com", "chase.com"] },
  { names: ["Truist"], key: "truist", domains: ["truist.com"] },
  { names: ["Lowe's", "Lowes"], key: "lowes", domains: ["lowes.com"] },
  { names: ["Duke Energy"], key: "dukeenergy", domains: ["duke-energy.com"] },
  { names: ["Honeywell"], key: "honeywell", domains: ["honeywell.com"] },
  { names: ["Walmart"], key: "walmart", domains: ["walmart.com", "walmartcareers.com"] },
  { names: ["CVS Health", "CVS"], key: "cvshealth", domains: ["cvs.com", "cvshealth.com"] },
  { names: ["UnitedHealth Group", "UnitedHealthcare"], key: "unitedhealth", domains: ["unitedhealthgroup.com", "uhc.com"] },
  { names: ["PayPal"], key: "paypal", domains: ["paypal.com"] },
  { names: ["Netflix"], key: "netflix", domains: ["netflix.com", "netflixhouse.com"] },
  { names: ["Salesforce"], key: "salesforce", domains: ["salesforce.com"] },
  { names: ["Oracle"], key: "oracle", domains: ["oracle.com"] },
  { names: ["Cisco"], key: "cisco", domains: ["cisco.com"] },
  { names: ["Intel"], key: "intel", domains: ["intel.com"] },
  { names: ["NVIDIA", "Nvidia"], key: "nvidia", domains: ["nvidia.com"] },
  { names: ["Tesla"], key: "tesla", domains: ["tesla.com"] },
  { names: ["FedEx"], key: "fedex", domains: ["fedex.com"] },
  { names: ["UPS"], key: "upsjobs", domains: ["ups.com", "jobs-ups.com"] },
  { names: ["Pfizer"], key: "pfizer", domains: ["pfizer.com"] },
  { names: ["Johnson & Johnson"], key: "johnsonandjohnson", domains: ["jnj.com"] },
  { names: ["PepsiCo"], key: "pepsico", domains: ["pepsico.com", "pepsicojobs.com"] },
  { names: ["Nike"], key: "nike", domains: ["nike.com"] },
  { names: ["Adobe"], key: "adobe", domains: ["adobe.com"] },
  { names: ["Uber"], key: "uber", domains: ["uber.com"] },
  { names: ["Airbnb"], key: "airbnb", domains: ["airbnb.com"] },
  { names: ["LPL Financial"], key: "lplfinancial", domains: ["lpl.com"] },
  { names: ["TIAA"], key: "tiaa", domains: ["tiaa.org"] },
  { names: ["USAA"], key: "usaa", domains: ["usaa.com"] },
  { names: ["SMBC"], key: "smbcgroup", domains: ["smbcgroup.com", "smbc.co.jp"] },
  { names: ["Coinbase"], key: "coinbase", domains: ["coinbase.com"] },
  { names: ["Robinhood"], key: "robinhood", domains: ["robinhood.com"] },
  { names: ["Halcyon Partners", "Halcyon"], key: "halcyonpartners", domains: ["halcyonpartners.com"] }
];

// Legit job boards and applicant-tracking systems. Postings hosted here are
// allowed to mention any company, so brand-mismatch and lookalike checks on the
// page's own domain are skipped (outbound links are still checked).
export const JOB_BOARDS = [
  "linkedin.com", "indeed.com", "joinhandshake.com", "greenhouse.io", "lever.co",
  "myworkdayjobs.com", "workday.com", "glassdoor.com", "ziprecruiter.com",
  "smartrecruiters.com", "icims.com", "jobvite.com", "ashbyhq.com", "taleo.net",
  "successfactors.com", "workable.com", "simplyhired.com", "monster.com", "wellfound.com", "dice.com"
];

// Infrastructure domains that contain brand names but are legitimate.
export const SAFE_INFRA = [
  "amazonaws.com", "cloudfront.net", "googleapis.com", "googleusercontent.com",
  "gstatic.com", "googletagmanager.com", "azureedge.net", "azurewebsites.net",
  "appspot.com", "akamaihd.net"
];

// Free email providers — real corporate recruiters almost never use these.
export const FREE_EMAIL = [
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
  "yahoo.com", "aol.com", "icloud.com", "proton.me", "protonmail.com",
  "gmx.com", "mail.com", "yandex.com", "zoho.com"
];
