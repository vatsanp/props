from prettytable import PrettyTable
import csv
import os
import sys


inverseStats = {
    "Passing Yards Per Game" : "Opponent Passing Yards Per Game",
    "Opponent Passing Yards Per Game" : "Passing Yards Per Game",
    
    "Passing TDs Per Game" : "Opponent Passing TDs Per Game",
    "Opponent Passing TDs Per Game" : "Passing TDs Per Game",
    
    "Rushing Yards Per Game" : "Opponent Rushing Yards Per Game",
    "Opponent Rushing Yards Per Game" : "Rushing Yards Per Game",
        
    "Rushing TDs Per Game" : "Opponent Rushing TDs Per Game",
    "Opponent Rushing TDs Per Game" : "Rushing TDs Per Game",
    
    "Points Per Game" : "Opponent Points Per Game",
    "Opponent Points Per Game" : "Points Per Game",
    
    "Q1 Points Per Game" : "Opponent Q1 Points Per Game",
    "Opponent Q1 Points Per Game" : "Q1 Points Per Game",
    
    "FG Made Per Game" : "Opponent FG Attempts Per Game",
    "Opponent FG Attempts Per Game" : "FG Made Per Game",
    
    "Interceptions Thrown Per Game" : "Opponent Interceptions Thrown Per Game",
    "Opponent Interceptions Thrown Per Game" : "Interceptions Thrown Per Game",
    
    "Sacks Per Game" : "Opponent Sacks Per Game",
    "Opponent Sacks Per Game" : "Sacks Per Game",
    
    "Defensive TDs Per Game" : "Opponent Defensive TDs Per Game",
    "Opponent Defensive TDs Per Game" : "Defensive TDs Per Game"
}

order = [
    "Passing Yards Per Game",
    "Opponent Passing Yards Per Game",
    "Passing TDs Per Game",
    "Opponent Passing TDs Per Game",
    "Rushing Yards Per Game",
    "Opponent Rushing Yards Per Game",
    "Rushing TDs Per Game",
    "Opponent Rushing TDs Per Game",
    "Points Per Game",
    "Opponent Points Per Game",
    "Q1 Points Per Game",
    "Opponent Q1 Points Per Game",
    "FG Made Per Game",
    "Opponent FG Attempts Per Game",
    "Interceptions Thrown Per Game",
    "Opponent Interceptions Thrown Per Game",
    "Sacks Per Game",
    "Opponent Sacks Per Game",
    "Defensive TDs Per Game",
    "Opponent Defensive TDs Per Game"
]

teams = {
    "ARI" : "Arizona",
    "ARZ" : "Arizona",
    "ATL" : "Atlanta",
    "BAL" : "Baltimore",
    "BUF" : "Buffalo",
    "CAR" : "Carolina",
    "CHI" : "Chicago",
    "CIN" : "Cincinnati",
    "CLE" : "Cleveland",
    "DAL" : "Dallas",
    "DEN" : "Denver",
    "DET" : "Detroit",
    "GB"  : "Green-Bay",
    "HOU" : "Houston",
    "IND" : "Indianapolis",
    "JAC" : "Jacksonville",
    "JAX" : "Jacksonville",
    "KC"  : "Kansas-City",
    "LAC" : "LA-Chargers",
    "LAR" : "LA-Rams",
    "LV"  : "Las-Vegas",
    "MIA" : "Miami",
    "MIN" : "Minnesota",
    "NE"  : "New-England",
    "NO"  : "New-Orleans",
    "NYG" : "NY-Giants",
    "NYJ" : "NY-Jets",
    "PHI" : "Philadelphia",
    "PIT" : "Pittsburgh",
    "SEA" : "Seattle",
    "SF"  : "San-Francisco",
    "TB"  : "Tampa-Bay",
    "TEN" : "Tennessee",
    "WAS" : "Washington",
    "WSH" : "Washington"
}

def sortFunc(str):
    stat = (str[:-4]).decode('utf-8')
    if stat in order:
        return order.index(stat)
    else:
        return 99
        
if len(sys.argv) > 1:
    team1 = sys.argv[1]
    team2 = ''
    if len(sys.argv) > 2:
        team2 = sys.argv[2]
else:
    team1 = input('Enter first team to find\n')
    team2 = input('Enter second team to find\n')
    
if team1 in teams:
    team1 = teams[team1]
if team2 in teams:
    team2 = teams[team2]
    
team1 = team1.replace('-', ' ')
team2 = team2.replace('-', ' ')

dir = "/Users/vatsan/Documents/Code/NFL_Stats/"
directory = os.fsencode(dir)
dirList = sorted(os.listdir(directory), key=sortFunc)

t1 = PrettyTable(['Stat', 'Rank', 'City', '2026', 'Last 3', 'Last 1', 'Home', 'Away', '2025'])
t2 = PrettyTable(['Stat', 'Rank', 'City', '2026', 'Last 3', 'Last 1', 'Home', 'Away', '2025'])
t3 = PrettyTable([team1, 'T1 Rank', 'T1 2026', '-', 'T2 2026', 'T2 Rank', team2])
team1Stats = {}
team2Stats = {}
    
for file in dirList:
    filename = os.fsdecode(file)
    if filename.endswith(".csv"):
        #read csv, and split on "," the line
        csv_file = csv.reader(open(dir+filename, "r"), delimiter=",")
        
        #loop through the csv list
        for row in csv_file:
            #if current rows 3rd value is equal to input, print that row
            if row[2] == team1:
#                if (int(row[1]) <= 10 or int(row[1]) > 20):
                row[0] = filename[:-4]
                t1.add_row(row)
                team1Stats[row[0]] = row
            elif row[2] == team2:
#                if (int(row[1]) <= 10 or int(row[1]) > 20):
                row[0] = filename[:-4]
                t2.add_row(row)
                team2Stats[row[0]] = row

if team2:
    for stat in team1Stats:
        inverse = inverseStats[stat]
        team1Stat = team1Stats[stat]
        team2Stat = team2Stats[inverse]
        if (int(team1Stat[1]) <= 10 and int(team2Stat[1]) > 20) or (int(team1Stat[1]) > 20 and int(team2Stat[1]) <= 10):
            row = [stat, team1Stat[1], team1Stat[3], '-', team2Stat[3], team2Stat[1], inverse]
            t3.add_row(row)

    t1.del_column("City")
    t2.del_column("City")

#    print(team1)
#    print(t1.get_string())
#
#    print("\n")
#
#    print(team2)
#    print(t2.get_string())
#
#    print("\n")

    print("Best Stats of " + team1 + " vs " + team2)
    print(t3.get_string())
else:
    t1.del_column("City")
    print(team1)
    print(t1.get_string())

print("\n");

