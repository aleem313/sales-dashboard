// TS port of docs/profiles/extract-profile.js for server-side use.
// Called from the snapshot upload route after unzipping the agent's Chrome
// "Save Page As → Webpage, Complete" output. The original CLI script is kept
// in docs/profiles/ for one-off host-machine extractions.

import * as vm from "vm";

export type ProfileExtractionErrorCode =
  | "no_nuxt"          // window.__NUXT__ block not present
  | "eval_failed"      // blob evaluated but threw / left no window.__NUXT__
  | "no_identity"      // post-extraction: identity.name missing
  | "no_stats";        // post-extraction: stats object missing

export class ProfileExtractionError extends Error {
  code: ProfileExtractionErrorCode;
  constructor(code: ProfileExtractionErrorCode, message: string) {
    super(message);
    this.name = "ProfileExtractionError";
    this.code = code;
  }
}

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

function scrapeFeedback(html: string): Array<{
  id: string;
  jobTitle: string | null;
  date: string | null;
  rating: number | null;
  clientName: string | null;
  comment: string | null;
  truncated: boolean;
}> {
  const sectionStart = html.indexOf('data-qa="feedback-section"');
  if (sectionStart === -1) return [];
  const sliceFromStart = html.slice(sectionStart);
  const sectionEnd = sliceFromStart.indexOf("</section>");
  const section = sectionEnd === -1 ? sliceFromStart : sliceFromStart.slice(0, sectionEnd);

  const cardRegex = /data-qa="(\d{6,})"([\s\S]*?)(?=data-qa="\d{6,}"|<\/section>|$)/g;
  const out: Array<{
    id: string;
    jobTitle: string | null;
    date: string | null;
    rating: number | null;
    clientName: string | null;
    comment: string | null;
    truncated: boolean;
  }> = [];
  let m: RegExpExecArray | null;
  while ((m = cardRegex.exec(section)) !== null) {
    const id = m[1];
    const card = m[2];
    const pick = (re: RegExp): string | null => {
      const x = re.exec(card);
      return x ? x[1].trim() : null;
    };
    const decode = (s: string | null): string | null =>
      s == null
        ? null
        : s
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&nbsp;/g, " ");

    const jobTitle = decode(pick(/data-test="feedback-title"[^>]*>\s*([^<]+?)\s*</));
    const date = decode(pick(/data-test="feedback-date"[^>]*>\s*([^<]+?)\s*</));
    const ratingTxt = pick(/air3-rating-value-text"[^>]*>\s*([\d.]+)\s*</);
    const ratingSr = pick(/Rating is ([\d.]+) out of 5/);
    const rating = ratingTxt ? parseFloat(ratingTxt) : ratingSr ? parseFloat(ratingSr) : null;
    const comment = decode(pick(/data-test="feedback-comment"[\s\S]*?<em>([\s\S]*?)<\/em>/));
    const clientName = decode(pick(/data-test="feedback-client-name"[^>]*>\s*([^<]+?)\s*</));
    const truncated = comment ? /\.\.\.|…/.test(comment) : false;

    out.push({ id, jobTitle, date, rating, clientName, comment, truncated });
  }
  return out;
}

// Extracts a clean freelancer profile object from the raw HTML of a saved
// Upwork profile page. Throws ProfileExtractionError on any structural issue
// — callers should catch and map error.code → user-facing message.
export function extractProfileFromHtml(
  html: string,
  sourceFile = "uploaded.html"
): Record<string, unknown> {
  const start = html.indexOf("window.__NUXT__=");
  if (start === -1) {
    throw new ProfileExtractionError(
      "no_nuxt",
      "window.__NUXT__ block not found in HTML"
    );
  }
  const scriptEnd = html.indexOf("</script>", start);
  const blob = html.slice(start, scriptEnd);

  type NuxtCtx = { window: { __NUXT__?: unknown } };
  const ctx: NuxtCtx = { window: {} };
  try {
    vm.createContext(ctx);
    vm.runInContext(blob, ctx as unknown as vm.Context);
  } catch (err) {
    throw new ProfileExtractionError(
      "eval_failed",
      `Failed to evaluate window.__NUXT__ blob: ${(err as Error).message}`
    );
  }
  const nuxt = ctx.window.__NUXT__ as
    | { state?: { profileViewer?: Record<string, unknown> } }
    | undefined;
  if (!nuxt || !nuxt.state) {
    throw new ProfileExtractionError(
      "eval_failed",
      "window.__NUXT__ evaluated but state is missing"
    );
  }

  const scrapedFeedback = scrapeFeedback(html);

  const pv = (nuxt.state.profileViewer || {}) as Record<string, unknown>;
  const p = (pv.profile || {}) as Record<string, unknown>;
  const pp = (p.profile || {}) as Record<string, unknown>;
  const stats = (p.stats || {}) as Record<string, unknown>;
  const identity = (p.identity || {}) as Record<string, unknown>;

  const portfolioV2 = pv.portfolioV2 as { relevantAllProjects?: unknown } | undefined;
  const portfoliosRelevant = arr<Record<string, unknown>>(
    portfolioV2?.relevantAllProjects
  );
  const portfoliosLegacy = arr<Record<string, unknown>>(p.portfolios);
  const portfolios = portfoliosRelevant.length ? portfoliosRelevant : portfoliosLegacy;

  const wh = (pv.workHistory || {}) as Record<string, unknown>;
  const ac = wh.assignmentsCompleted as { pageItems?: unknown } | undefined;
  const aip = wh.assignmentsInProgress as { pageItems?: unknown } | undefined;
  const workHistory = [
    ...arr<Record<string, unknown>>(ac?.pageItems),
    ...arr<Record<string, unknown>>(aip?.pageItems),
    ...arr<Record<string, unknown>>(wh.assignments),
  ];

  const employmentHistory = arr<Record<string, unknown>>(p.employmentHistory);
  const education = arr<Record<string, unknown>>(p.education);
  const certificates = arr<Record<string, unknown>>(p.certificates);
  const otherExperiences = arr<Record<string, unknown>>(p.otherExperiences);
  const languages = arr<Record<string, unknown>>(p.languages);
  const jobCategoriesV2 = arr<Record<string, unknown>>(p.jobCategoriesV2).length
    ? arr<Record<string, unknown>>(p.jobCategoriesV2)
    : arr<Record<string, unknown>>(p.jobCategories);
  const specialized = arr<Record<string, unknown>>(p.specializedProfilesInfo);
  const skills = arr<Record<string, unknown>>(pp.skills);
  const softSkills = pv.softSkills as { tagsList?: unknown } | undefined;
  const softSkillsList = arr<Record<string, unknown>>(softSkills?.tagsList);
  const responsivenessTags = arr<Record<string, unknown>>(pv.responsivenessTags);

  const portrait = pp.portrait as { portrait500?: string; portrait?: string } | undefined;
  const talentVanity = p.talentVanityUrl as { vanityUrl?: string } | undefined;

  const profile = {
    source: { file: sourceFile, extractedAt: new Date().toISOString() },

    identity: {
      name: (pp.name as string) || null,
      firstName: (pp.firstName as string) || null,
      shortName: (pp.shortName as string) || null,
      title: (pp.title as string) || null,
      location: pp.location || null,
      portraitUrl: portrait?.portrait500 || portrait?.portrait || null,
      vanityUrl: (p.vanityUrl as string) || talentVanity?.vanityUrl || null,
      profileUrl: (p.profileUrl as string) || null,
      ciphertext: (identity.ciphertext as string) || null,
      uid: (identity.uid as string) || null,
      recno: (identity.recno as number) || null,
      idVerified: (pp.idVerified as boolean) || false,
      phoneVerified: (pp.phoneVerified as boolean) || false,
      contractorTier: (pp.contractorTier as number) || null,
    },

    description: (pp.description as string) || null,

    stats: {
      rating: stats.rating ?? null,
      ratingRecent: stats.ratingRecent ?? null,
      totalFeedback: stats.totalFeedback ?? null,
      totalFeedbackRecent: stats.totalFeedbackRecent ?? null,
      totalJobsWorked: stats.totalJobsWorked ?? null,
      totalJobsWorkedRecent: stats.totalJobsWorkedRecent ?? null,
      totalHours: stats.totalHours ?? null,
      totalHoursActual: stats.totalHoursActual ?? null,
      totalHoursRecent: stats.totalHoursRecent ?? null,
      totalHourlyJobs: stats.totalHourlyJobs ?? null,
      totalFixedJobs: stats.totalFixedJobs ?? null,
      hourlyRate: stats.hourlyRate ?? null,
      totalEarnings: stats.totalEarnings ?? null,
      totalRevenue: stats.totalRevenue ?? null,
      recentEarnings: stats.recentEarnings ?? null,
      topRatedStatus: stats.topRatedStatus ?? null,
      topRatedPlusStatus: stats.topRatedPlusStatus ?? null,
      // jobSuccessScore: numeric JSS is no longer exposed by Upwork's SSR.
      // nSS100BwScore is a binary flag now (1/0), not a 0-100 percentage.
      // Always null; use topRatedStatus / topRatedPlusStatus as proxies.
      jobSuccessScore: null,
      memberSince: stats.memberSince ?? null,
      lastWorkedOn: stats.lastWorkedOn ?? null,
      totalPortfolioItems: stats.totalPortfolioItems ?? null,
      responsiveState: stats.responsiveState ?? null,
      hireAgainPercentage: stats.hireAgainPercentage ?? null,
      recommended: stats.recommended ?? null,
    },

    skills: skills.map((s) => ({
      uid: (s.uid as string) || (s.id as string) || null,
      name: (s.prettyName as string) || (s.name as string) || null,
      isHighlighted: !!(
        s.highlighted ||
        arr<string>(pv.highlightedSkillsUids).includes(s.uid as string)
      ),
    })),

    softSkills: softSkillsList.map((s) => ({
      uid: (s.uid as string) || null,
      name: (s.prettyName as string) || (s.name as string) || null,
    })),

    responsivenessTags,

    jobCategories: jobCategoriesV2.flatMap((g) =>
      arr<Record<string, unknown>>(g.selectedCategories).map((c) => ({
        groupId: (g.groupId as string) || null,
        groupName: (g.groupName as string) || null,
        uid: (c.uid as string) || (c.id as string) || null,
        name: (c.prettyName as string) || (c.name as string) || null,
      }))
    ),

    specializedProfiles: specialized.map((s) => {
      const so = s.selectedOccupation as
        | { occupationUID?: string; prefLabel?: string }
        | undefined;
      return {
        occupationUid: so?.occupationUID || (s.occupationUid as string) || null,
        occupation: so?.prefLabel || null,
        title: (s.title as string) || null,
        description: (s.description as string) || null,
        skills: arr<Record<string, unknown>>(s.skills).map(
          (x) => (x.prettyName as string) || (x.name as string)
        ),
      };
    }),

    languages: languages.map((l) => {
      const lang = l.language as { name?: string } | undefined;
      return {
        name: lang?.name || (l.name as string) || null,
        proficiency: (l.proficiency as string) || (l.englishProficiency as string) || null,
      };
    }),

    certificates: certificates.map((c) => ({
      name: (c.name as string) || null,
      provider: (c.providerName as string) || (c.provider as string) || null,
      description: (c.description as string) || null,
      dateEarned: (c.dateEarned as string) || null,
      dateEnd: (c.dateEnd as string) || null,
      url: (c.url as string) || null,
    })),

    employmentHistory: employmentHistory.map((e) => ({
      company: (e.companyName as string) || (e.company as string) || null,
      role: (e.jobTitle as string) || (e.title as string) || null,
      startDate: (e.startDate as string) || null,
      endDate: (e.endDate as string) || null,
      current: !!e.currentJob,
      location: (e.location as string) || null,
      description: (e.description as string) || null,
    })),

    education: education.map((e) => ({
      institution: (e.institutionName as string) || (e.school as string) || null,
      degree: (e.degree as string) || null,
      areaOfStudy: (e.areaOfStudy as string) || null,
      startYear: (e.dateStarted as string) || null,
      endYear: (e.dateEnded as string) || null,
      description: (e.description as string) || null,
    })),

    otherExperiences: otherExperiences.map((e) => ({
      subject: (e.subject as string) || null,
      description: (e.description as string) || null,
    })),

    portfolio: portfolios.map((pr) => ({
      uid: (pr.uid as string) || (pr.id as string) || null,
      title: (pr.title as string) || (pr.name as string) || null,
      description: (pr.description as string) || (pr.summary as string) || null,
      coverImage:
        (pr.coverImageUrl as string) ||
        (pr.thumbnailUrl as string) ||
        (pr.coverImage as string) ||
        null,
      url: (pr.projectUrl as string) || (pr.url as string) || null,
      skills: arr<Record<string, unknown>>(pr.skills).map(
        (s) => (s.prettyName as string) || (s.name as string)
      ),
      createdOn: (pr.createdOn as string) || (pr.createdAt as string) || null,
    })),

    workHistory: workHistory.map((w) => {
      const fb = w.feedback as { score?: number; comment?: string } | null | undefined;
      const fbToClient = w.feedbackToClient as
        | { score?: number; comment?: string }
        | null
        | undefined;
      const client = w.client as
        | {
            country?: string;
            location?: { country?: string };
            totalSpent?: number;
            totalReviews?: number;
            totalFeedback?: number;
          }
        | null
        | undefined;
      return {
        title: (w.title as string) || (w.jobTitle as string) || null,
        type:
          (w.type as string) ||
          (w.jobType === 1 ? "hourly" : w.jobType === 2 ? "fixed" : null),
        status: (w.status as string) || null,
        startedOn: (w.startedOn as string) || (w.startDate as string) || null,
        endedOn: (w.endedOn as string) || (w.endDate as string) || null,
        rate: w.rate ?? w.hourlyRate ?? null,
        totalCharge: w.totalCharge ?? null,
        totalHours: w.totalHours ?? null,
        feedback: fb ? { score: fb.score ?? null, comment: fb.comment || null } : null,
        feedbackToClient: fbToClient
          ? { score: fbToClient.score ?? null, comment: fbToClient.comment || null }
          : null,
        client: client
          ? {
              country: client.country || client.location?.country || null,
              totalSpent: client.totalSpent ?? null,
              totalReviews: client.totalReviews ?? null,
              totalFeedback: client.totalFeedback ?? null,
            }
          : null,
      };
    }),

    feedback: scrapedFeedback,

    availability: p.availability || null,
    agencies: p.agencies || [],
    hideEarnings: !!p.hideEarnings,
    connectsBalance: pv.connectsBalance || null,
  };

  // Post-extraction validation — the same fields saveUpworkProfileSnapshot
  // requires. Surfacing these here gives the agent a clearer error than the
  // DB layer would.
  if (!profile.identity.name || typeof profile.identity.name !== "string") {
    throw new ProfileExtractionError(
      "no_identity",
      "Extracted data is missing identity.name — profile page may not have fully loaded"
    );
  }
  if (!profile.stats || typeof profile.stats !== "object") {
    throw new ProfileExtractionError(
      "no_stats",
      "Extracted data is missing stats — profile page may not have fully loaded"
    );
  }

  return profile;
}
