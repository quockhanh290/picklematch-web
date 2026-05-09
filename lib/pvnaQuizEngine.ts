import QUESTIONS_DATA from '../pavnquiz/questions.json';
import ENGINE_SPEC from '../pavnquiz/engine-spec.json';

export type PvnaQuestionId = string;

export type PvnaOption = {
  value: number;
  label: string;
};

export type PvnaQuestion = {
  id: PvnaQuestionId;
  title: string;
  description: string;
  phase: string;
  weight: number;
  options: PvnaOption[];
};

export type PvnaQuizState = {
  answers: Record<PvnaQuestionId, number>;
  gender: 'male' | 'female';
};

export type PvnaResult = {
  rawScore: number;
  pvnaLevel: string;
  levelName: string;
  duprRange: string;
  isProvisional: boolean;
};

export function getPvnaQuestions(): PvnaQuestion[] {
  return QUESTIONS_DATA.questions as PvnaQuestion[];
}

export function calculatePvnaResult(state: PvnaQuizState): PvnaResult {
  const { answers, gender } = state;
  const questions = getPvnaQuestions();
  
  // 1. Calculate raw score
  // Formula: (sum(answer_value * weight) / sum(5 * weight)) * 5, excluding ageGroup
  let weightedSum = 0;
  let maxWeightedSum = 0;
  
  Object.entries(answers).forEach(([qId, value]) => {
    if (qId === 'ageGroup') return;
    
    const question = questions.find(q => q.id === qId);
    if (question) {
      weightedSum += value * question.weight;
      maxWeightedSum += 5 * question.weight;
    }
  });
  
  const rawScore = maxWeightedSum > 0 ? (weightedSum / maxWeightedSum) * 5 : 0;
  
  // 2. Find level
  const genderLevels = (ENGINE_SPEC.levels as any)[gender];
  let level = genderLevels[0];
  
  for (const l of genderLevels) {
    if (rawScore >= l.scoreMin && rawScore < l.scoreMax) {
      level = l;
      break;
    }
    // Fallback to last level if rawScore is high
    if (rawScore >= genderLevels[genderLevels.length - 1].scoreMin) {
      level = genderLevels[genderLevels.length - 1];
    }
  }
  
  // 3. Age adjustment
  const ageGroup = answers['ageGroup'] || 2; // Default to 19-34 if missing
  const multiplier = (ENGINE_SPEC.age_multiplier as any)[ageGroup.toString()] || 1.0;
  
  let adjustedPvna = parseFloat(level.pvna) * multiplier;
  
  // 4. Gender floor
  const floor = (ENGINE_SPEC.pvna_floor_after_age_adjust as any)[gender];
  if (adjustedPvna < floor) {
    adjustedPvna = floor;
  }
  
  return {
    rawScore: parseFloat(rawScore.toFixed(2)),
    pvnaLevel: adjustedPvna.toFixed(1),
    levelName: level.name,
    duprRange: level.dupr,
    isProvisional: true
  };
}

export function getNextQuestions(state: PvnaQuizState): PvnaQuestionId[] {
  const { answers } = state;
  const spec = ENGINE_SPEC.branching;
  
  // Always start with screening
  const screeningIds = spec.screening_questions;
  const hasAllScreening = screeningIds.every(id => answers[id] !== undefined);
  
  if (!hasAllScreening) {
    return screeningIds;
  }
  
  // Screening complete, determine path
  const screeningScore = calculatePhaseScore(state, 'screening');
  
  let path: string[];
  if (screeningScore <= ENGINE_SPEC.screening_thresholds.beginner_max) {
    path = spec.beginner_path;
  } else if (screeningScore <= ENGINE_SPEC.screening_thresholds.intermediate_max) {
    path = spec.intermediate_path;
  } else {
    path = spec.advanced_path;
  }
  
  // Combine unique IDs
  const combined = Array.from(new Set([...screeningIds, ...path, ...spec.always_append]));
  return combined;
}

function calculatePhaseScore(state: PvnaQuizState, phase: string): number {
  const { answers } = state;
  const questions = getPvnaQuestions();
  
  let weightedSum = 0;
  let maxWeightedSum = 0;
  
  questions.filter(q => q.phase === phase).forEach(q => {
    const value = answers[q.id];
    if (value !== undefined && q.id !== 'ageGroup') {
      weightedSum += value * q.weight;
      maxWeightedSum += 5 * q.weight;
    }
  });
  
  return maxWeightedSum > 0 ? (weightedSum / maxWeightedSum) * 5 : 0;
}
