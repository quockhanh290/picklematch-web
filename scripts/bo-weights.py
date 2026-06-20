"""
Bayesian Optimization for scoring weights using Optuna.

Finds optimal DEFAULT_SCORING_WEIGHTS by minimizing external quality score
(based on user priority: intra-team PVNA > inter-team > repeats > rest > gender > group).

Usage: python scripts/bo-weights.py [--trials=150]
"""

import subprocess
import json
import sys
import os
import argparse

import optuna
optuna.logging.set_verbosity(optuna.logging.WARNING)

def log(msg=""):
    import builtins
    builtins.print(str(msg), flush=True)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)

# Current engine defaults (baseline)
BASELINE = {
    "pvna": 1.0,
    "partner_repeat": 3.0,
    "opponent_repeat": 1.5,
    "group_bonus": 6.0,
    "partner_gender_pref": 4.0,
    "opponent_gender_pref": 2.0,
    "consecutive_play": 4.0,
}

# Search bounds for each weight
BOUNDS = {
    "pvna":                 (0.5, 12.0),
    "partner_repeat":       (0.5, 8.0),
    "opponent_repeat":      (0.5, 5.0),
    "group_bonus":          (0.5, 10.0),
    "partner_gender_pref":  (0.5, 8.0),
    "opponent_gender_pref": (0.5, 5.0),
    "consecutive_play":     (0.5, 8.0),
}


def run_eval(weights: dict) -> dict:
    weight_args = " ".join(f"--{k}={v:.4f}" for k, v in weights.items())
    cmd = f"npx tsx scripts/eval-weights.ts {weight_args}"
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        cwd=PROJECT_DIR,
        shell=True,
    )
    if result.returncode != 0 or not result.stdout.strip():
        raise RuntimeError(f"eval-weights failed:\n{result.stderr[:500]}")
    return json.loads(result.stdout.strip())


def objective(trial: optuna.Trial) -> float:
    weights = {
        k: trial.suggest_float(k, lo, hi)
        for k, (lo, hi) in BOUNDS.items()
    }
    data = run_eval(weights)
    return data["quality"]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--trials", type=int, default=150)
    opts = parser.parse_args()

    n_trials = opts.trials

    # Evaluate baseline first
    log(f"\nBayesian Optimization -- {n_trials} trials")
    log(f"Scenario: 32p/4c, 12 rounds\n")
    log("Evaluating baseline (current engine weights)...")
    try:
        baseline_data = run_eval(BASELINE)
        baseline_q = baseline_data["quality"]
        log(f"  Baseline quality: {baseline_q:.4f}")
        log(f"  Baseline metrics: {json.dumps(baseline_data['metrics'], indent=4)}\n")
    except Exception as e:
        log(f"  Baseline eval failed: {e}")
        baseline_q = None

    # Run BO
    log(f"Running {n_trials} Bayesian Optimization trials...\n")
    study = optuna.create_study(
        direction="minimize",
        sampler=optuna.samplers.TPESampler(seed=42, n_startup_trials=20),
    )
    # Seed with baseline as a known point
    study.enqueue_trial(BASELINE)

    completed = [0]
    best_so_far = [float("inf")]

    def callback(study, trial):
        completed[0] += 1
        if trial.value is not None and trial.value < best_so_far[0]:
            best_so_far[0] = trial.value
            p = trial.params
            log(f"  Trial {completed[0]:3d}: quality={trial.value:.4f}  * new best"
                  f"  pvna={p.get('pvna',0):.2f}"
                  f"  p_rpt={p.get('partner_repeat',0):.2f}"
                  f"  o_rpt={p.get('opponent_repeat',0):.2f}"
                  f"  g_pref={p.get('partner_gender_pref',0):.2f}"
                  f"  og_pref={p.get('opponent_gender_pref',0):.2f}"
                  f"  grp={p.get('group_bonus',0):.2f}"
                  f"  c_play={p.get('consecutive_play',0):.2f}")
        elif completed[0] % 10 == 0:
            log(f"  Trial {completed[0]:3d}: quality={trial.value:.4f}  (best={best_so_far[0]:.4f})")

    study.optimize(objective, n_trials=n_trials, callbacks=[callback], show_progress_bar=False)

    best = study.best_trial

    log(f"\n{'='*60}")
    pct_str = ""
    if baseline_q is not None:
        pct = (best.value - baseline_q) / baseline_q * 100
        pct_str = f"  (vs baseline: {pct:+.1f}%)"
    log(f"RESULTS -- Best quality: {best.value:.4f}{pct_str}")
    log(f"{'='*60}")

    log("\nOptimal weights vs current engine:")
    log(f"  {'Weight':<22}  {'Current':>8}  {'Optimal':>8}  {'Delta':>8}")
    log(f"  {'-'*50}")
    for k in BOUNDS:
        cur = BASELINE[k]
        opt = best.params[k]
        delta = (opt - cur) / cur * 100
        marker = "^" if opt > cur * 1.1 else ("v" if opt < cur * 0.9 else " ")
        log(f"  {k:<22}  {cur:>8.2f}  {opt:>8.2f}  {delta:>+7.1f}%  {marker}")

    # Evaluate best weights to get full metrics breakdown
    log("\nEvaluating optimal weights...")
    try:
        best_data = run_eval(best.params)
        log(f"\nMetrics comparison (baseline vs optimal):")
        log(f"  {'Metric':<22}  {'Baseline':>10}  {'Optimal':>10}  {'Delta':>8}")
        log(f"  {'-'*54}")
        bm = baseline_data["metrics"] if baseline_q else {}
        om = best_data["metrics"]
        labels = {
            "intra_pvna":       "Intra-team PVNA",
            "inter_pvna":       "Inter-team PVNA",
            "p_rpt_rate":       "Partner repeat rate",
            "c_rest_rate":      "Consec rest rate",
            "o_rpt_rate":       "Opp repeat rate",
            "c_play_rate":      "Consec play rate",
            "gender_viol_rate": "Gender violation rate",
        }
        for k, label in labels.items():
            bv = bm.get(k, 0)
            ov = om.get(k, 0)
            delta = (ov - bv) / max(bv, 1e-9) * 100 if bv else 0
            log(f"  {label:<22}  {bv:>10.4f}  {ov:>10.4f}  {delta:>+7.1f}%")
    except Exception as e:
        log(f"  Failed: {e}")

    log(f"\n{'-'*60}")
    log("Suggested DEFAULT_SCORING_WEIGHTS update (state.ts):")
    log("export const DEFAULT_SCORING_WEIGHTS = {")
    for k in BOUNDS:
        v = best.params[k]
        log(f"  {k}: {v:.2f},")
    log("}")


if __name__ == "__main__":
    main()
