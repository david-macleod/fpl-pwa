#!/usr/bin/env python3
"""
Plot overall rank by gameweek for teams in FPL League 1549023
"""

import requests
import matplotlib.pyplot as plt
from typing import Dict, List

FPL_BASE_URL = 'https://fantasy.premierleague.com/api'
LEAGUE_ID = 1549023


def fetch_data(endpoint: str) -> Dict:
    """Fetch data from FPL API"""
    url = f"{FPL_BASE_URL}{endpoint}"
    response = requests.get(url)
    response.raise_for_status()
    return response.json()


def main():
    print(f"\n📊 Fetching rank history for league {LEAGUE_ID}...\n")

    # Get league standings to get team IDs
    league = fetch_data(f'/leagues-classic/{LEAGUE_ID}/standings/')
    standings = league['standings']['results']

    print(f"League: {league['league']['name']}")
    print(f"Teams: {len(standings)}\n")

    # Fetch history for each team
    team_histories = {}

    for standing in standings:
        team_id = standing['entry']
        team_name = standing['entry_name']
        manager_name = standing['player_name']

        print(f"Fetching history for {team_name} ({manager_name})...")

        # Get team history
        history_data = fetch_data(f'/entry/{team_id}/history/')

        # Extract gameweek data
        gw_data = history_data['current']

        gameweeks = [gw['event'] for gw in gw_data]
        overall_ranks = [gw['overall_rank'] for gw in gw_data]

        team_histories[team_name] = {
            'manager': manager_name,
            'gameweeks': gameweeks,
            'ranks': overall_ranks
        }

    print("\n✅ Data fetched successfully!\n")

    # Create the plot
    plt.figure(figsize=(14, 8))

    # Plot each team's rank progression
    colors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12']  # Red, Blue, Green, Orange

    for (team_name, data), color in zip(team_histories.items(), colors):
        plt.plot(
            data['gameweeks'],
            data['ranks'],
            marker='o',
            linewidth=2,
            markersize=6,
            label=f"{team_name} ({data['manager']})",
            color=color
        )

    # Formatting
    plt.xlabel('Gameweek', fontsize=12, fontweight='bold')
    plt.ylabel('Overall Rank', fontsize=12, fontweight='bold')
    plt.title(f'{league["league"]["name"]} - Overall Rank by Gameweek',
              fontsize=14, fontweight='bold', pad=20)

    # Invert y-axis so lower rank (better) is at the top
    plt.gca().invert_yaxis()

    # Add grid for better readability
    plt.grid(True, alpha=0.3, linestyle='--')

    # Legend
    plt.legend(loc='best', fontsize=10, framealpha=0.9)

    # Format y-axis to show ranks with commas
    ax = plt.gca()
    ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f'{int(x):,}'))

    # Set x-axis to show all gameweeks
    if team_histories:
        first_team = list(team_histories.values())[0]
        plt.xticks(first_team['gameweeks'])

    plt.tight_layout()

    # Save the plot
    output_file = 'league_rank_progression.png'
    plt.savefig(output_file, dpi=300, bbox_inches='tight')
    print(f"📈 Plot saved to: {output_file}")

    # Also display statistics
    print("\n📊 STATISTICS")
    print("=" * 80)

    for team_name, data in team_histories.items():
        best_rank = min(data['ranks'])
        worst_rank = max(data['ranks'])
        current_rank = data['ranks'][-1]
        best_gw = data['gameweeks'][data['ranks'].index(best_rank)]

        print(f"\n{team_name} ({data['manager']})")
        print(f"  Current Rank: {current_rank:,}")
        print(f"  Best Rank: {best_rank:,} (GW{best_gw})")
        print(f"  Worst Rank: {worst_rank:,}")
        print(f"  Rank Change from GW1: {data['ranks'][-1] - data['ranks'][0]:+,}")

    print("\n" + "=" * 80)
    print(f"\n✨ Done! Open {output_file} to view the plot.\n")


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(f"\n❌ Error: {e}")
        raise
