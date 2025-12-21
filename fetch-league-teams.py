#!/usr/bin/env python3
"""
Fetch team details for FPL League 1549023
https://fantasy.premierleague.com/leagues/1549023/standings/
"""

import requests
import time
from typing import Dict, List

FPL_BASE_URL = 'https://fantasy.premierleague.com/api'
LEAGUE_ID = 1549023


def fetch_data(endpoint: str) -> Dict:
    """Fetch data from FPL API"""
    url = f"{FPL_BASE_URL}{endpoint}"
    response = requests.get(url)
    response.raise_for_status()
    return response.json()


def get_position_name(element_type: int) -> str:
    """Convert position ID to name"""
    positions = {1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD'}
    return positions.get(element_type, 'UNK')


def main():
    print(f"\n🏆 Fetching league details for ID: {LEAGUE_ID}\n")

    # Get bootstrap data
    print("Fetching bootstrap data...")
    bootstrap = fetch_data('/bootstrap-static/')

    # Find current gameweek
    current_gw = next((gw for gw in bootstrap['events'] if gw['is_current']), None)
    if not current_gw:
        print("❌ No current gameweek found")
        return

    print(f"Current Gameweek: {current_gw['id']}")

    # Get league standings
    print("Fetching league standings...")
    league = fetch_data(f'/leagues-classic/{LEAGUE_ID}/standings/')

    print(f"\nLeague: {league['league']['name']}")
    print(f"Total Teams: {len(league['standings']['results'])}\n")
    print("=" * 80)

    # Process each team
    standings = league['standings']['results']

    for i, standing in enumerate(standings):
        team_id = standing['entry']

        print(f"\n[{i + 1}] {standing['entry_name']} - {standing['player_name']}")
        print("-" * 80)

        try:
            # Get team details
            team_data = fetch_data(f'/entry/{team_id}/')

            # Get current gameweek picks
            pick_data = fetch_data(f'/entry/{team_id}/event/{current_gw["id"]}/picks/')

            print(f"Team ID: {team_id}")
            print(f"Overall Points: {team_data['summary_overall_points']:,}")
            print(f"Overall Rank: {team_data['summary_overall_rank']:,}")
            print(f"GW{current_gw['id']} Points: {pick_data['entry_history']['points']}")
            print(f"Team Value: £{team_data['last_deadline_value'] / 10:.1f}m")
            print(f"Bank: £{team_data['last_deadline_bank'] / 10:.1f}m")

            # Display squad
            print(f"\nSquad for GW{current_gw['id']}:")

            xi = [p for p in pick_data['picks'] if p['position'] <= 11]
            bench = [p for p in pick_data['picks'] if p['position'] > 11]

            print("\nStarting XI:")
            for pick in xi:
                player = next((p for p in bootstrap['elements'] if p['id'] == pick['element']), None)
                if player:
                    team = next((t for t in bootstrap['teams'] if t['id'] == player['team']), None)
                    pos_name = get_position_name(player['element_type'])
                    captain = ' (C)' if pick['is_captain'] else ' (V)' if pick['is_vice_captain'] else ''

                    print(f"  {pick['position']}. {player['web_name']}{captain} - {pos_name} ({team['short_name'] if team else 'UNK'})")

            print("\nBench:")
            for pick in bench:
                player = next((p for p in bootstrap['elements'] if p['id'] == pick['element']), None)
                if player:
                    team = next((t for t in bootstrap['teams'] if t['id'] == player['team']), None)
                    pos_name = get_position_name(player['element_type'])

                    print(f"  {pick['position'] - 11}. {player['web_name']} - {pos_name} ({team['short_name'] if team else 'UNK'})")

            # Small delay to avoid rate limiting
            time.sleep(0.1)

        except Exception as e:
            print(f"  ❌ Error fetching details: {e}")

        print("=" * 80)

    # Summary
    print("\n📊 SUMMARY")
    print("=" * 80)
    print(f"Total teams processed: {len(standings)}")
    print(f"League ID: {LEAGUE_ID}")
    print(f"League URL: https://fantasy.premierleague.com/leagues/{LEAGUE_ID}/standings/")


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(f"\n❌ Error: {e}")
        raise
