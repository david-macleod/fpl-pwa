#!/usr/bin/env python3
import requests
import json

# Get current gameweek from bootstrap-static
bootstrap_url = "https://fantasy.premierleague.com/api/bootstrap-static/"
bootstrap_response = requests.get(bootstrap_url)
bootstrap_data = bootstrap_response.json()

# Find current gameweek
current_gw = None
for event in bootstrap_data['events']:
    if event['is_current']:
        current_gw = event['id']
        break

print(f"Current Gameweek: {current_gw}")
print()

# Get fixtures for current gameweek
fixtures_url = f"https://fantasy.premierleague.com/api/fixtures/?event={current_gw}"
fixtures_response = requests.get(fixtures_url)
fixtures_data = fixtures_response.json()

# Create team lookup
teams = {team['id']: team['short_name'] for team in bootstrap_data['teams']}

print("Fixture States:")
print("-" * 60)

for fixture in fixtures_data:
    if fixture['started']:
        home_team = teams.get(fixture['team_h'], 'Unknown')
        away_team = teams.get(fixture['team_a'], 'Unknown')
        
        print(f"{home_team} vs {away_team}:")
        print(f"  Started: {fixture['started']}")
        print(f"  Finished: {fixture['finished']}")
        print(f"  Finished Provisional: {fixture['finished_provisional']}")
        print(f"  Minutes: {fixture['minutes']}")
        print(f"  Home Score: {fixture['team_h_score']}")
        print(f"  Away Score: {fixture['team_a_score']}")
        print()