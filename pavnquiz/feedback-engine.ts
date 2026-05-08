export type QuestionOption = {
  value: number;
  label: string;
  description?: string;
};

export type Question = {
  id: string;
  title: string;
  phase: string;
  options: QuestionOption[];
};

export type Answers = Record<string, number | undefined>;

export type StrengthLevel = "strong" | "stable" | "developing";

export type StrengthItem = {
  id: string;
  title: string;
  description: string;
  answer: number;
  level: StrengthLevel;
};

export type SkillNeedWorkItem = {
  id: string;
  title: string;
  answer: number;
  tip: string;
};

export type FeedbackResult = {
  beginnerFlag: boolean;
  strengths: StrengthItem[];
  skillsNeedWork: SkillNeedWorkItem[];
};

const EXCLUDED_FOR_NEED_WORK = new Set([
  "ageGroup",
  "racketSportsBackground",
  "pickleballExperience",
]);

const SKILL_TIPS: Record<string, string> = {
  rallyAbility: "Tap rally voi partner, focus giu bong qua luoi.",
  serveBasic: "Tap serve 50 qua/ngay, focus vao do on dinh.",
  returnBasic: "Tap return deep, tien len NVZ sau return.",
  nvzUnderstanding: "Xem video NVZ rules va strategy, tap dung vi tri kitchen.",
  dinkConsistency: "Tap dink drill 10 phut moi session, giu bong thap.",
  dinkControl: "Tap cross-court dink va down-the-line dink.",
  thirdShotDrop: "Tap third-shot drop tu baseline vao NVZ.",
  backhandSoft: "Tap backhand dink/drop voi wall hoac partner.",
  backhandDrive: "Tap backhand drive co topspin va control huong bong.",
  volleyHandBattles: "Tap volley exchange can luoi, nang reflex va counter.",
  footworkPositioning: "Tap split-step, lateral movement, recovery step.",
  transitionZone: "Tap reset shot tu mid-court, chon drop/drive dung luc.",
  backhandSlide: "Tap backhand slide dink/drop va angle control.",
  speedupCounter: "Tap speed-up timing va counter-attack sau speed-up.",
  advancedShots: "Tap ATP/Erne theo tinh huong, uu tien do chinh xac truoc.",
  twoHandedAdvantage: "Tap two-handed backhand cho soft shot va drive co kiem soat.",
  strategyTeamwork: "Tap communication, stacking, va pattern play trong danh doi.",
  competitionLevel: "Thi dau them giai de tang kinh nghiem thuc chien.",
  consistencyUnderPressure: "Tap bai mental game: breathing, routine, point reset.",
  pointConstruction: "Tap xay dung diem: target weakness va shot selection high-percentage.",
  errorRate: "Giam toc do trong pha kho, uu tien consistency truoc power.",
};

function normalizeTitle(title: string): string {
  return title.replace(/\?+$/g, "").trim();
}

export function generateFeedback(questions: Question[], answers: Answers): FeedbackResult {
  const answered = questions
    .map((q) => ({ q, v: answers[q.id] }))
    .filter((x): x is { q: Question; v: number } => typeof x.v === "number");

  const values = answered.map((x) => x.v);
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  const beginnerFlag = avg < 2.5;

  const strong: StrengthItem[] = [];
  const stable: StrengthItem[] = [];
  const developing: StrengthItem[] = [];

  for (const { q, v } of answered) {
    if (q.id === "ageGroup") continue;

    const option = q.options.find((o) => o.value === v);
    if (!option) continue;

    const item: Omit<StrengthItem, "level"> = {
      id: q.id,
      title: normalizeTitle(q.title),
      description: option.label,
      answer: v,
    };

    if (v >= 4) {
      strong.push({ ...item, level: "strong" });
    } else if (v === 3) {
      stable.push({ ...item, level: "stable" });
    } else if (v === 2 && beginnerFlag) {
      developing.push({ ...item, level: "developing" });
    }
  }

  strong.sort((a, b) => b.answer - a.answer);
  stable.sort((a, b) => b.answer - a.answer);
  developing.sort((a, b) => b.answer - a.answer);

  const strengths: StrengthItem[] = [...strong];

  if (strengths.length < 3) {
    const needed = 3 - strengths.length;
    strengths.push(...stable.slice(0, needed));
  }

  if (beginnerFlag && strengths.length < 3) {
    const needed = 3 - strengths.length;
    strengths.push(...developing.slice(0, needed));
  }

  const skillsNeedWork = answered
    .filter(({ q, v }) => v <= 2 && !EXCLUDED_FOR_NEED_WORK.has(q.id))
    .map(({ q, v }) => ({
      id: q.id,
      title: normalizeTitle(q.title),
      answer: v,
      tip: SKILL_TIPS[q.id] ?? "Tiep tuc luyen tap ky nang nay.",
    }))
    .sort((a, b) => a.answer - b.answer)
    .slice(0, 4);

  return {
    beginnerFlag,
    strengths: strengths.slice(0, 6),
    skillsNeedWork,
  };
}
