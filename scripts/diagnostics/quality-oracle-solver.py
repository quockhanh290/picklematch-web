#!/usr/bin/env python3
"""Exact/ bounded full-board quality oracle for PickleMatch diagnostics."""

from __future__ import annotations

import argparse
import itertools
import json
import math
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ortools import __version__ as ortools_version
from ortools.sat.python import cp_model


SCALE = 100


def scaled(value: float) -> int:
    return int(round(float(value) * SCALE))


def unscaled(value: int | float) -> float:
    return round(float(value) / SCALE, 4)


def pair_key(left: str, right: str) -> str:
    return "|".join(sorted((left, right)))


def count_map(raw: Any) -> dict[str, int]:
    if isinstance(raw, dict):
        return {str(key): int(value) for key, value in raw.items()}
    if isinstance(raw, list):
        return {str(key): int(value) for key, value in raw}
    return {}


@dataclass(frozen=True)
class Player:
    player_id: str
    pvna: float
    matches_played: int
    consecutive_rest: int
    quality_debt: float
    gender: str | None
    partner_gender_pref: str
    opponent_gender_pref: str
    partner_counts: dict[str, int]
    opponent_counts: dict[str, int]

    @property
    def partner_burden(self) -> int:
        return sum(max(0, count - 1) for count in self.partner_counts.values())

    @property
    def opponent_burden(self) -> int:
        return sum(max(0, count - 1) for count in self.opponent_counts.values())


@dataclass(frozen=True)
class Candidate:
    candidate_id: int
    team_a: tuple[str, str]
    team_b: tuple[str, str]
    player_ids: tuple[str, str, str, str]
    team_gap: int
    max_intra_gap: int
    quality_debt_delta: dict[str, int]
    partner_burden_delta: dict[str, int]
    opponent_burden_delta: dict[str, int]
    partner_repeat_events: int
    opponent_repeat_events: int
    gender_penalty: int
    avoid_opponent_events: int


def preference(value: Any) -> str:
    if value in ("M", "male"):
        return "M"
    if value in ("F", "female"):
        return "F"
    return "any"


def gender(value: Any) -> str | None:
    if value in ("M", "male"):
        return "M"
    if value in ("F", "female"):
        return "F"
    return None


def load_players(payload: dict[str, Any]) -> dict[str, Player]:
    result: dict[str, Player] = {}
    busy = {str(value) for value in payload.get("busy_player_ids", [])}
    for raw in payload.get("players", []):
        player_id = str(raw.get("id") or raw.get("player_id"))
        if not player_id or player_id == "None":
            continue
        if raw.get("checked_out") or raw.get("checked_out_at") or raw.get("opted_rest") or player_id in busy:
            continue
        result[player_id] = Player(
            player_id=player_id,
            pvna=float(raw.get("effective_pvna") or raw.get("pvna") or 0),
            matches_played=int(raw.get("matches_played") or 0),
            consecutive_rest=int(raw.get("consecutive_rest") or 0),
            quality_debt=float(raw.get("quality_debt") or 0),
            gender=gender(raw.get("gender")),
            partner_gender_pref=preference(raw.get("partner_gender_pref")),
            opponent_gender_pref=preference(raw.get("opponent_gender_pref")),
            partner_counts=count_map(raw.get("partner_counts")),
            opponent_counts=count_map(raw.get("opponent_counts")),
        )
    return result


def preference_penalty(player: Player, partner: Player, opponents: tuple[Player, Player]) -> int:
    penalty = 0
    if player.partner_gender_pref != "any" and partner.gender != player.partner_gender_pref:
        penalty += 1
    if (
        player.opponent_gender_pref != "any"
        and all(opponent.gender != player.opponent_gender_pref for opponent in opponents)
    ):
        penalty += 1
    return penalty


def build_candidate(
    candidate_id: int,
    team_a_ids: tuple[str, str],
    team_b_ids: tuple[str, str],
    players: dict[str, Player],
    tolerance: float,
    avoid_pairs: set[str],
) -> Candidate | None:
    team_a = (players[team_a_ids[0]], players[team_a_ids[1]])
    team_b = (players[team_b_ids[0]], players[team_b_ids[1]])
    if pair_key(*team_a_ids) in avoid_pairs or pair_key(*team_b_ids) in avoid_pairs:
        return None

    team_gap_value = abs(sum(player.pvna for player in team_a) - sum(player.pvna for player in team_b))
    intra_a = abs(team_a[0].pvna - team_a[1].pvna)
    intra_b = abs(team_b[0].pvna - team_b[1].pvna)
    partner_delta: dict[str, int] = {}
    opponent_delta: dict[str, int] = {}
    debt_delta: dict[str, int] = {}

    for pair in (team_a, team_b):
        repeat = int(pair[0].partner_counts.get(pair[1].player_id, 0) > 0)
        partner_delta[pair[0].player_id] = repeat
        partner_delta[pair[1].player_id] = repeat
    for player, opponents in (
        (team_a[0], team_b),
        (team_a[1], team_b),
        (team_b[0], team_a),
        (team_b[1], team_a),
    ):
        opponent_delta[player.player_id] = sum(
            int(player.opponent_counts.get(opponent.player_id, 0) > 0)
            for opponent in opponents
        )
    for player in team_a:
        debt_delta[player.player_id] = scaled(
            max(0.0, team_gap_value - tolerance) * 2 + max(0.0, intra_a - 1)
        )
    for player in team_b:
        debt_delta[player.player_id] = scaled(
            max(0.0, team_gap_value - tolerance) * 2 + max(0.0, intra_b - 1)
        )

    gender_penalty = sum(
        (
            preference_penalty(team_a[0], team_a[1], team_b),
            preference_penalty(team_a[1], team_a[0], team_b),
            preference_penalty(team_b[0], team_b[1], team_a),
            preference_penalty(team_b[1], team_b[0], team_a),
        )
    )
    avoid_opponents = sum(
        int(pair_key(left.player_id, right.player_id) in avoid_pairs)
        for left in team_a
        for right in team_b
    )
    return Candidate(
        candidate_id=candidate_id,
        team_a=team_a_ids,
        team_b=team_b_ids,
        player_ids=(*team_a_ids, *team_b_ids),
        team_gap=scaled(team_gap_value),
        max_intra_gap=scaled(max(intra_a, intra_b)),
        quality_debt_delta=debt_delta,
        partner_burden_delta=partner_delta,
        opponent_burden_delta=opponent_delta,
        partner_repeat_events=sum(partner_delta.values()) // 2,
        opponent_repeat_events=sum(opponent_delta.values()) // 2,
        gender_penalty=gender_penalty,
        avoid_opponent_events=avoid_opponents,
    )


def board_metrics(
    selected: list[Candidate],
    players: dict[str, Player],
    required_ids: set[str],
) -> dict[str, Any]:
    selected_ids = {player_id for candidate in selected for player_id in candidate.player_ids}
    projected_matches = {
        player_id: player.matches_played + int(player_id in selected_ids)
        for player_id, player in players.items()
    }
    quality_debt = {
        player_id: scaled(player.quality_debt)
        for player_id, player in players.items()
    }
    partner_burden = {
        player_id: player.partner_burden
        for player_id, player in players.items()
    }
    opponent_burden = {
        player_id: player.opponent_burden
        for player_id, player in players.items()
    }
    for candidate in selected:
        for player_id in candidate.player_ids:
            quality_debt[player_id] += candidate.quality_debt_delta[player_id]
            partner_burden[player_id] += candidate.partner_burden_delta[player_id]
            opponent_burden[player_id] += candidate.opponent_burden_delta[player_id]
    partner_preference_penalty = sum(
        int(players[left].partner_gender_pref != "any"
            and players[right].gender != players[left].partner_gender_pref)
        + int(players[right].partner_gender_pref != "any"
              and players[left].gender != players[right].partner_gender_pref)
        for candidate in selected
        for left, right in (candidate.team_a, candidate.team_b)
    )
    return {
        "courts": len(selected),
        "rest_recovery_misses": len(required_ids - selected_ids),
        "unserved_required_ids": sorted(required_ids - selected_ids),
        "match_count_spread": max(projected_matches.values()) - min(projected_matches.values()),
        "max_quality_debt": unscaled(max(quality_debt.values(), default=0)),
        "max_team_gap": unscaled(max((candidate.team_gap for candidate in selected), default=0)),
        "max_opponent_burden": max(opponent_burden.values(), default=0),
        "opponent_repeat_events": sum(candidate.opponent_repeat_events for candidate in selected),
        "max_partner_burden": max(partner_burden.values(), default=0),
        "partner_repeat_events": sum(candidate.partner_repeat_events for candidate in selected),
        "max_intra_gap": unscaled(max((candidate.max_intra_gap for candidate in selected), default=0)),
        "partner_preference_penalty": partner_preference_penalty,
        "gender_penalty": sum(candidate.gender_penalty for candidate in selected),
        "avoid_opponent_events": sum(candidate.avoid_opponent_events for candidate in selected),
    }


def chosen_candidates(
    raw_matches: list[dict[str, Any]],
    players: dict[str, Player],
    tolerance: float,
    avoid_pairs: set[str],
) -> tuple[list[Candidate], list[str]]:
    selected: list[Candidate] = []
    errors: list[str] = []
    seen: set[str] = set()
    for index, raw in enumerate(raw_matches):
        team_a = tuple(str(value) for value in raw.get("team_a", []))
        team_b = tuple(str(value) for value in raw.get("team_b", []))
        if len(team_a) != 2 or len(team_b) != 2:
            errors.append(f"match_{index}:invalid_team_shape")
            continue
        ids = (*team_a, *team_b)
        if len(set(ids)) != 4:
            errors.append(f"match_{index}:duplicate_player")
            continue
        unavailable = [player_id for player_id in ids if player_id not in players]
        if unavailable:
            errors.append(f"match_{index}:unavailable={','.join(unavailable)}")
            continue
        overlap = seen.intersection(ids)
        if overlap:
            errors.append(f"match_{index}:board_overlap={','.join(sorted(overlap))}")
            continue
        candidate = build_candidate(index, team_a, team_b, players, tolerance, avoid_pairs)
        if candidate is None:
            errors.append(f"match_{index}:hard_avoid_partner")
            continue
        selected.append(candidate)
        seen.update(ids)
    return selected, errors


def solve(payload: dict[str, Any], time_limit: float, workers: int) -> dict[str, Any]:
    started = time.perf_counter()
    players = load_players(payload)
    player_ids = sorted(players)
    tolerance = float(payload.get("pvna_tolerance") or 0.5)
    requested_courts = int(payload.get("target_courts") or payload.get("court_count") or 1)
    target_courts = min(requested_courts, len(players) // 4)
    required_ids = {
        player_id for player_id, player in players.items()
        if player.consecutive_rest >= 1
    }
    avoid_pairs = {
        pair_key(str(raw.get("player_a")), str(raw.get("player_b")))
        for raw in payload.get("avoid_pairs", [])
        if raw.get("player_a") and raw.get("player_b")
    }
    if target_courts <= 0:
        return {
            "status": "INFEASIBLE",
            "reason": "no_fillable_court",
            "available_players": len(players),
            "target_courts": target_courts,
        }

    model = cp_model.CpModel()
    slot_count = target_courts * 4
    max_pvna = max(scaled(player.pvna) for player in players.values())
    min_pvna = min(scaled(player.pvna) for player in players.values())
    max_team_gap_bound = max(1, 2 * (max_pvna - min_pvna))
    max_intra_bound = max(1, max_pvna - min_pvna)

    assignment: dict[tuple[str, int], cp_model.IntVar] = {}
    selected: dict[str, cp_model.LinearExpr] = {}
    slot_player_index = []
    slot_pvna = []
    for slot in range(slot_count):
        slot_vars = []
        for player_index, player_id in enumerate(player_ids):
            variable = model.new_bool_var(f"x_{player_index}_{slot}")
            assignment[player_id, slot] = variable
            slot_vars.append(variable)
        model.add_exactly_one(slot_vars)
        index_var = model.new_int_var(0, len(player_ids) - 1, f"slot_player_{slot}")
        model.add(index_var == sum(
            player_index * assignment[player_id, slot]
            for player_index, player_id in enumerate(player_ids)
        ))
        slot_player_index.append(index_var)
        pvna_var = model.new_int_var(min_pvna, max_pvna, f"slot_pvna_{slot}")
        model.add(pvna_var == sum(
            scaled(players[player_id].pvna) * assignment[player_id, slot]
            for player_id in player_ids
        ))
        slot_pvna.append(pvna_var)

    for player_id in player_ids:
        expression = sum(assignment[player_id, slot] for slot in range(slot_count))
        model.add(expression <= 1)
        selected[player_id] = expression

    team_member: dict[tuple[str, int, int], cp_model.IntVar] = {}
    court_gap_vars = []
    team_intra_vars: dict[tuple[int, int], cp_model.IntVar] = {}
    gap_excess_vars = []
    intra_excess_vars: dict[tuple[int, int], cp_model.IntVar] = {}
    for court in range(target_courts):
        base = court * 4
        model.add(slot_player_index[base] < slot_player_index[base + 1])
        model.add(slot_player_index[base + 2] < slot_player_index[base + 3])
        model.add(
            slot_player_index[base] + slot_player_index[base + 1]
            <= slot_player_index[base + 2] + slot_player_index[base + 3]
        )
        if court > 0:
            model.add(slot_player_index[(court - 1) * 4] < slot_player_index[base])

        for team in range(2):
            team_base = base + team * 2
            for player_id in player_ids:
                member = model.new_bool_var(f"member_{player_id}_{court}_{team}")
                model.add(member == assignment[player_id, team_base] + assignment[player_id, team_base + 1])
                team_member[player_id, court, team] = member
            intra = model.new_int_var(0, max_intra_bound, f"intra_{court}_{team}")
            model.add_abs_equality(intra, slot_pvna[team_base] - slot_pvna[team_base + 1])
            team_intra_vars[court, team] = intra
            intra_excess = model.new_int_var(0, max_intra_bound, f"intra_excess_{court}_{team}")
            model.add_max_equality(intra_excess, [intra - SCALE, 0])
            intra_excess_vars[court, team] = intra_excess

        gap = model.new_int_var(0, max_team_gap_bound, f"team_gap_{court}")
        model.add_abs_equality(
            gap,
            slot_pvna[base] + slot_pvna[base + 1]
            - slot_pvna[base + 2] - slot_pvna[base + 3],
        )
        court_gap_vars.append(gap)
        gap_excess = model.new_int_var(0, max_team_gap_bound, f"gap_excess_{court}")
        model.add_max_equality(gap_excess, [gap - scaled(tolerance), 0])
        gap_excess_vars.append(gap_excess)

    for raw in payload.get("avoid_pairs", []):
        left = str(raw.get("player_a"))
        right = str(raw.get("player_b"))
        if left not in players or right not in players:
            continue
        for court in range(target_courts):
            for team in range(2):
                model.add(team_member[left, court, team] + team_member[right, court, team] <= 1)

    def both(variable_a: cp_model.IntVar, variable_b: cp_model.IntVar, name: str):
        relation = model.new_bool_var(name)
        model.add(relation <= variable_a)
        model.add(relation <= variable_b)
        model.add(relation >= variable_a + variable_b - 1)
        return relation

    partner_relation_cache: dict[str, cp_model.LinearExpr] = {}
    opponent_relation_cache: dict[str, cp_model.LinearExpr] = {}

    def partner_relation(left: str, right: str):
        key = pair_key(left, right)
        if key not in partner_relation_cache:
            partner_relation_cache[key] = sum(
                both(
                    team_member[left, court, team],
                    team_member[right, court, team],
                    f"partner_{left}_{right}_{court}_{team}",
                )
                for court in range(target_courts)
                for team in range(2)
            )
        return partner_relation_cache[key]

    def opponent_relation(left: str, right: str):
        key = pair_key(left, right)
        if key not in opponent_relation_cache:
            opponent_relation_cache[key] = sum(
                (
                    both(
                        team_member[left, court, 0],
                        team_member[right, court, 1],
                        f"opponent_ab_{left}_{right}_{court}",
                    )
                    + both(
                        team_member[left, court, 1],
                        team_member[right, court, 0],
                        f"opponent_ba_{left}_{right}_{court}",
                    )
                )
                for court in range(target_courts)
            )
        return opponent_relation_cache[key]

    rest_misses = model.new_int_var(0, len(required_ids), "rest_misses")
    model.add(rest_misses == sum(1 - selected[player_id] for player_id in required_ids))

    projected_match_vars = []
    projected_debt_vars = []
    projected_partner_vars = []
    projected_opponent_vars = []
    quality_product_bound = max_team_gap_bound * 2 + max_intra_bound

    def selected_value_product(
        value: cp_model.IntVar,
        selector: cp_model.IntVar,
        upper_bound: int,
        name: str,
    ):
        product = model.new_int_var(0, upper_bound, name)
        model.add(product <= value)
        model.add(product <= upper_bound * selector)
        model.add(product >= value - upper_bound * (1 - selector))
        return product

    total_partner_repeats: list[cp_model.LinearExpr] = []
    total_opponent_repeats: list[cp_model.LinearExpr] = []
    for left, right in itertools.combinations(player_ids, 2):
        left_player = players[left]
        right_player = players[right]
        if left_player.partner_counts.get(right, 0) > 0 or right_player.partner_counts.get(left, 0) > 0:
            total_partner_repeats.append(partner_relation(left, right))
        if left_player.opponent_counts.get(right, 0) > 0 or right_player.opponent_counts.get(left, 0) > 0:
            total_opponent_repeats.append(opponent_relation(left, right))

    for player_id, player in players.items():
        projected_match = model.new_int_var(
            player.matches_played,
            player.matches_played + 1,
            f"projected_matches_{player_id}",
        )
        model.add(projected_match == player.matches_played + selected[player_id])
        projected_match_vars.append(projected_match)

        debt_parts = []
        for court in range(target_courts):
            for team in range(2):
                member = team_member[player_id, court, team]
                gap_part = selected_value_product(
                    gap_excess_vars[court],
                    member,
                    max_team_gap_bound,
                    f"gap_debt_{player_id}_{court}_{team}",
                )
                intra_part = selected_value_product(
                    intra_excess_vars[court, team],
                    member,
                    max_intra_bound,
                    f"intra_debt_{player_id}_{court}_{team}",
                )
                debt_parts.append(gap_part * 2 + intra_part)
        base_debt = scaled(player.quality_debt)
        debt_var = model.new_int_var(
            base_debt,
            base_debt + quality_product_bound,
            f"quality_debt_{player_id}",
        )
        model.add(debt_var == base_debt + sum(debt_parts))
        projected_debt_vars.append(debt_var)

        partner_deltas = [
            partner_relation(player_id, other)
            for other in player_ids
            if other != player_id and player.partner_counts.get(other, 0) > 0
        ]
        partner_var = model.new_int_var(
            player.partner_burden,
            player.partner_burden + 1,
            f"partner_burden_{player_id}",
        )
        model.add(partner_var == player.partner_burden + sum(partner_deltas))
        projected_partner_vars.append(partner_var)

        opponent_deltas = [
            opponent_relation(player_id, other)
            for other in player_ids
            if other != player_id and player.opponent_counts.get(other, 0) > 0
        ]
        opponent_var = model.new_int_var(
            player.opponent_burden,
            player.opponent_burden + 2,
            f"opponent_burden_{player_id}",
        )
        model.add(opponent_var == player.opponent_burden + sum(opponent_deltas))
        projected_opponent_vars.append(opponent_var)

    max_matches_bound = max(player.matches_played for player in players.values()) + 1
    min_matches = model.new_int_var(0, max_matches_bound, "min_matches")
    max_matches = model.new_int_var(0, max_matches_bound, "max_matches")
    model.add_min_equality(min_matches, projected_match_vars)
    model.add_max_equality(max_matches, projected_match_vars)
    match_spread = model.new_int_var(0, max_matches_bound, "match_spread")
    model.add(match_spread == max_matches - min_matches)

    max_quality_debt_bound = max(
        scaled(player.quality_debt) + quality_product_bound for player in players.values()
    )
    max_quality_debt = model.new_int_var(0, max_quality_debt_bound, "max_quality_debt")
    model.add_max_equality(max_quality_debt, projected_debt_vars)
    max_team_gap = model.new_int_var(0, max_team_gap_bound, "max_team_gap")
    model.add_max_equality(max_team_gap, court_gap_vars)
    max_intra_gap = model.new_int_var(0, max_intra_bound, "max_intra_gap")
    model.add_max_equality(max_intra_gap, list(team_intra_vars.values()))
    max_opponent_burden = model.new_int_var(
        0,
        max(player.opponent_burden + 2 for player in players.values()),
        "max_opponent_burden",
    )
    model.add_max_equality(max_opponent_burden, projected_opponent_vars)
    max_partner_burden = model.new_int_var(
        0,
        max(player.partner_burden + 1 for player in players.values()),
        "max_partner_burden",
    )
    model.add_max_equality(max_partner_burden, projected_partner_vars)

    avoid_opponent_relations = [
        opponent_relation(str(raw.get("player_a")), str(raw.get("player_b")))
        for raw in payload.get("avoid_pairs", [])
        if str(raw.get("player_a")) in players and str(raw.get("player_b")) in players
    ]
    partner_preference_penalties = []
    for left, right in itertools.combinations(player_ids, 2):
        left_player = players[left]
        right_player = players[right]
        mismatch = int(
            left_player.partner_gender_pref != "any"
            and right_player.gender != left_player.partner_gender_pref
        ) + int(
            right_player.partner_gender_pref != "any"
            and left_player.gender != right_player.partner_gender_pref
        )
        if mismatch > 0:
            partner_preference_penalties.append(mismatch * partner_relation(left, right))

    objectives: list[tuple[str, cp_model.LinearExpr, bool]] = [
        ("rest_recovery_misses", rest_misses, False),
        ("match_count_spread", match_spread, False),
        ("max_quality_debt", max_quality_debt, True),
        ("max_team_gap", max_team_gap, True),
        ("max_opponent_burden", max_opponent_burden, False),
        ("opponent_repeat_events", sum(total_opponent_repeats), False),
        ("max_partner_burden", max_partner_burden, False),
        ("partner_repeat_events", sum(total_partner_repeats), False),
        ("max_intra_gap", max_intra_gap, True),
        ("avoid_opponent_events", sum(avoid_opponent_relations), False),
        ("partner_preference_penalty", sum(partner_preference_penalties), False),
        ("total_quality_debt", sum(projected_debt_vars), True),
    ]

    model_build_ms = (time.perf_counter() - started) * 1000
    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = max(1, workers)
    solver.parameters.random_seed = 0
    stage_results = []
    final_status = cp_model.UNKNOWN
    last_solution_assignment: list[list[str]] | None = None
    for name, objective, is_scaled in objectives:
        remaining = time_limit - (time.perf_counter() - started)
        if remaining <= 0:
            break
        solver.parameters.max_time_in_seconds = remaining
        model.minimize(objective)
        validation_error = model.validate()
        if validation_error:
            raise ValueError(f"Invalid CP-SAT model before {name}: {validation_error}")
        print(f"[oracle] solving {name}", file=sys.stderr, flush=True)
        stage_started = time.perf_counter()
        status = solver.solve(model)
        final_status = status
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            stage_results.append({
                "name": name,
                "status": solver.status_name(status),
                "elapsed_ms": round((time.perf_counter() - stage_started) * 1000, 1),
            })
            break
        value = int(round(solver.value(objective)))
        bound = int(round(solver.best_objective_bound))
        last_solution_assignment = [
            [
                next(
                    player_id for player_id in player_ids
                    if solver.value(assignment[player_id, court * 4 + offset])
                )
                for offset in range(4)
            ]
            for court in range(target_courts)
        ]
        stage_results.append({
            "name": name,
            "status": solver.status_name(status),
            "value": unscaled(value) if is_scaled else value,
            "best_bound": unscaled(bound) if is_scaled else bound,
            "elapsed_ms": round((time.perf_counter() - stage_started) * 1000, 1),
        })
        if status != cp_model.OPTIMAL:
            break
        model.add(objective == value)

    selected_candidates: list[Candidate] = []
    if last_solution_assignment is not None:
        for court, assigned in enumerate(last_solution_assignment):
            candidate = build_candidate(
                court,
                (assigned[0], assigned[1]),
                (assigned[2], assigned[3]),
                players,
                tolerance,
                avoid_pairs,
            )
            if candidate is not None:
                selected_candidates.append(candidate)

    selected = selected_candidates
    oracle_metrics = board_metrics(selected, players, required_ids) if selected else None
    raw_engine_matches = payload.get("engine_matches") or payload.get("chosen_matches") or []
    engine_board, engine_errors = chosen_candidates(
        raw_engine_matches,
        players,
        tolerance,
        avoid_pairs,
    )
    if raw_engine_matches and len(engine_board) != target_courts:
        engine_errors.append(
            f"board:expected_courts={target_courts},valid_courts={len(engine_board)}"
        )
    engine_metrics = board_metrics(engine_board, players, required_ids) if engine_board else None

    result_status = solver.status_name(final_status)
    all_stages_optimal = len(stage_results) == len(objectives) and all(
        stage.get("status") == "OPTIMAL" for stage in stage_results
    )
    classification = "NO_ENGINE_BOARD"
    if engine_errors:
        classification = "INVALID_ENGINE_BOARD"
    elif engine_metrics and oracle_metrics:
        metric_order = (
            "rest_recovery_misses",
            "match_count_spread",
            "max_quality_debt",
            "max_team_gap",
            "max_opponent_burden",
            "opponent_repeat_events",
            "max_partner_burden",
            "partner_repeat_events",
            "max_intra_gap",
            "avoid_opponent_events",
            "partner_preference_penalty",
        )
        oracle_tuple = tuple(oracle_metrics[key] for key in metric_order)
        engine_tuple = tuple(engine_metrics[key] for key in metric_order)
        if oracle_tuple < engine_tuple:
            classification = "ENGINE_MISSED_BETTER_BOARD" if all_stages_optimal else "PROVEN_BETTER_BOARD_FOUND"
        elif oracle_tuple == engine_tuple and all_stages_optimal:
            classification = "ENGINE_AT_ORACLE_OPTIMUM"
        else:
            classification = "NO_PROVEN_ENGINE_MISS"

    return {
        "status": "OPTIMAL" if all_stages_optimal else result_status,
        "classification": classification,
        "proof_scope": {
            "hard_constraints": [
                "exactly four distinct available players per court",
                "no player appears on more than one court",
                "avoid-pairs cannot be partners",
                "exact target court count",
            ],
            "objective_order": [name for name, _, _ in objectives],
            "note": (
                "OPTIMAL means every listed lexicographic stage was proven optimal. "
                "Opponent gender preference is reported in gender_penalty but is not "
                "part of the proof objective."
            ),
        },
        "input": {
            "session_id": payload.get("session_id"),
            "current_round": payload.get("current_round"),
            "pvna_tolerance": tolerance,
            "requested_courts": requested_courts,
            "available_players": len(players),
            "busy_players": len(payload.get("busy_player_ids", [])),
            "target_courts": target_courts,
            "required_rest_recovery_ids": sorted(required_ids),
            "combinatorial_match_count": math.comb(len(players), 4) * 3,
            "assignment_variable_count": len(players) * slot_count,
        },
        "solver": {
            "name": "Google OR-Tools CP-SAT",
            "version": ortools_version,
            "workers": max(1, workers),
            "random_seed": 0,
        },
        "timing": {
            "model_build_ms": round(model_build_ms, 1),
            "total_ms": round((time.perf_counter() - started) * 1000, 1),
            "time_limit_ms": round(time_limit * 1000),
        },
        "stages": stage_results,
        "oracle": {
            "metrics": oracle_metrics,
            "matches": [
                {"team_a": list(candidate.team_a), "team_b": list(candidate.team_b)}
                for candidate in selected
            ],
        },
        "engine": {
            "metrics": engine_metrics,
            "validation_errors": engine_errors,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("--time-limit", type=float, default=60.0)
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()
    payload = json.loads(args.input.read_text(encoding="utf-8"))
    print(json.dumps(solve(payload, args.time_limit, args.workers), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
