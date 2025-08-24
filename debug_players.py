#!/usr/bin/env python3
import requests
import json

# Get current gameweek and team data
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

# Create player and team lookups
players_lookup = {player['web_name'].lower(): player for player in bootstrap_data['elements']}
teams_lookup = {team['id']: team for team in bootstrap_data['teams']}

# Get fixtures for current gameweek
fixtures_url = f"https://fantasy.premierleague.com/api/fixtures/?event={current_gw}"
fixtures_response = requests.get(fixtures_url)
fixtures_data = fixtures_response.json()

# Create fixture lookup by team ID
fixtures_by_team = {}
for fixture in fixtures_data:
    fixtures_by_team[fixture['team_h']] = fixture
    fixtures_by_team[fixture['team_a']] = fixture

# Get live data
live_url = f"https://fantasy.premierleague.com/api/event/{current_gw}/live/"
live_response = requests.get(live_url)
live_data = live_response.json()

# Create live data lookup
live_lookup = {element['id']: element['stats'] for element in live_data['elements']}

def analyze_player(player_name):
    print(f"\n=== {player_name.upper()} ===")
    
    # Find player
    player = players_lookup.get(player_name.lower())
    if not player:
        print(f"Player '{player_name}' not found!")
        return
    
    player_id = player['id']
    team_id = player['team']
    team_info = teams_lookup[team_id]
    
    print(f"Player ID: {player_id}")
    print(f"Team: {team_info['name']} ({team_info['short_name']})")
    print(f"Position: {player['element_type']}")
    
    # Get fixture info
    fixture = fixtures_by_team.get(team_id)
    if fixture:
        home_team = teams_lookup[fixture['team_h']]['short_name']
        away_team = teams_lookup[fixture['team_a']]['short_name']
        is_home = fixture['team_h'] == team_id
        
        print(f"Fixture: {home_team} vs {away_team} {'(HOME)' if is_home else '(AWAY)'}")
        print(f"Started: {fixture['started']}")
        print(f"Finished: {fixture['finished']}")
        print(f"Finished Provisional: {fixture['finished_provisional']}")
        print(f"Minutes: {fixture['minutes']}")
    
    # Get live stats
    live_stats = live_lookup.get(player_id, {})
    print(f"\nLive Stats:")
    print(f"  Minutes: {live_stats.get('minutes', 0)}")
    print(f"  Total Points: {live_stats.get('total_points', 0)}")
    print(f"  Bonus: {live_stats.get('bonus', 0)}")
    print(f"  Goals: {live_stats.get('goals_scored', 0)}")
    print(f"  Assists: {live_stats.get('assists', 0)}")
    print(f"  Yellow Cards: {live_stats.get('yellow_cards', 0)}")
    print(f"  Red Cards: {live_stats.get('red_cards', 0)}")
    
    # Apply our logic
    if fixture:
        game_minutes = fixture['minutes'] or 0
        player_minutes = live_stats.get('minutes', 0)
        has_red_card = live_stats.get('red_cards', 0) > 0
        
        # Our logic from the app
        game_in_progress = fixture['started'] and not fixture['finished_provisional']
        bonus_pending = fixture['finished_provisional'] and not fixture['finished'] and player_minutes > 0
        
        player_done = False
        didnt_play = False
        
        if fixture['finished']:
            player_done = True
            didnt_play = player_minutes == 0
        elif has_red_card:
            player_done = True
        elif player_minutes > 0 and player_minutes < game_minutes - 5:
            player_done = True
        
        print(f"\nOur Logic Results:")
        print(f"  Game In Progress: {game_in_progress}")
        print(f"  Bonus Pending: {bonus_pending}")
        print(f"  Player Done: {player_done}")
        print(f"  Didn't Play: {didnt_play}")
        
        # Determine expected color
        if player_done and didnt_play:
            expected_color = "RED (no minutes)"
        elif player_done:
            expected_color = "GREEN (game finished)"
        else:
            expected_color = "WHITE (still playing)"
        
        print(f"  Expected Color: {expected_color}")

# Analyze the specific players mentioned
analyze_player("Sels")
analyze_player("De Cuyper")