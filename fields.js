// Shared profile schema: used by the profile editor (options page).
// "autocomplete" is the standard HTML token that lets Chrome's own autofill (saved addresses and
// contact info) fill that field on the profile page.
// Matching rules for job-site questions live in core.js (RULES and PHRASES).

const YES_NO = ["", "Yes", "No"];
const DECLINE = "Decline to self-identify";

const PROFILE_FIELDS = [
  { section: "Basics" },
  { key: "firstName", label: "First name", autocomplete: "given-name" },
  { key: "middleName", label: "Middle name", autocomplete: "additional-name" },
  { key: "lastName", label: "Last name", autocomplete: "family-name" },
  { key: "preferredName", label: "Preferred name", autocomplete: "nickname" },
  { key: "pronouns", label: "Pronouns" },
  { key: "email", label: "Email", type: "email", autocomplete: "email" },
  { key: "phone", label: "Phone", type: "tel", autocomplete: "tel" },

  { section: "Address" },
  { key: "address1", label: "Street address", autocomplete: "address-line1" },
  { key: "address2", label: "Apt / suite", autocomplete: "address-line2" },
  { key: "city", label: "City", autocomplete: "address-level2" },
  { key: "state", label: "State / province", autocomplete: "address-level1" },
  { key: "zip", label: "ZIP / postal code", autocomplete: "postal-code" },
  { key: "country", label: "Country", autocomplete: "country-name" },

  { section: "Links" },
  { key: "linkedin", label: "LinkedIn URL" },
  { key: "github", label: "GitHub URL" },
  { key: "portfolio", label: "Portfolio / website URL", autocomplete: "url" },
  { key: "twitter", label: "X / Twitter URL" },

  { section: "Experience" },
  { key: "currentCompany", label: "Current / most recent company", autocomplete: "organization" },
  { key: "currentTitle", label: "Current / most recent title", autocomplete: "organization-title" },
  { key: "yearsExperience", label: "Years of experience" },
  { key: "school", label: "School / university" },
  { key: "degree", label: "Degree (e.g. Bachelor's)" },
  { key: "major", label: "Field of study" },
  { key: "gradYear", label: "Graduation year" },

  { section: "Logistics" },
  { key: "workAuthorized", label: "Legally authorized to work in this country?", options: YES_NO },
  { key: "needsSponsorship", label: "Will you need visa sponsorship?", options: YES_NO },
  { key: "over18", label: "Are you 18 or older?", options: YES_NO },
  { key: "willingToRelocate", label: "Willing to relocate?", options: YES_NO },
  { key: "previouslyEmployed", label: "Previously worked at the company?", options: YES_NO },
  { key: "salary", label: "Desired salary" },
  { key: "startDate", label: "Earliest start date / notice period" },
  { key: "referralSource", label: "How did you hear about us?" },

  { section: "Voluntary self-identification (optional)" },
  { key: "gender", label: "Gender", options: ["", "Male", "Female", "Non-binary", DECLINE] },
  { key: "hispanic", label: "Hispanic or Latino?", options: ["", "Yes", "No", DECLINE] },
  { key: "race", label: "Race / ethnicity", options: ["", "American Indian or Alaska Native", "Asian", "Black or African American", "Native Hawaiian or Other Pacific Islander", "White", "Two or More Races", DECLINE] },
  { key: "veteran", label: "Veteran status", options: ["", "I am not a protected veteran", "I identify as one or more of the classifications of protected veteran", DECLINE] },
  { key: "disability", label: "Disability status", options: ["", "No, I do not have a disability", "Yes, I have a disability", DECLINE] },

  { section: "Long answers" },
  { key: "summary", label: "Short professional summary (used for 'Tell us about yourself')", type: "textarea" },
  { key: "coverLetter", label: "Cover letter text", type: "textarea" }
];
