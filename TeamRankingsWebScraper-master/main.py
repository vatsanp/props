from package import *
import sys
import os


def main():

    links = [
        ["https://www.teamrankings.com/nfl/stat/opponent-rushing-yards-per-game", "Opponent Rushing Yards Per Game"],
        ["https://www.teamrankings.com/nfl/stat/opponent-rushing-touchdowns-per-game", "Opponent Rushing TDs Per Game"],
        ["https://www.teamrankings.com/nfl/stat/opponent-passing-yards-per-game", "Opponent Passing Yards Per Game"],
        ["https://www.teamrankings.com/nfl/stat/opponent-passing-touchdowns-per-game", "Opponent Passing TDs Per Game"],
        ["https://www.teamrankings.com/nfl/stat/field-goals-made-per-game", "FG Made Per Game"],
        ["https://www.teamrankings.com/nfl/stat/opponent-field-goal-attempts-per-game", "Opponent FG Attempts Per Game"],
        ["https://www.teamrankings.com/nfl/stat/1st-quarter-points-per-game", "Q1 Points Per Game"],
        ["https://www.teamrankings.com/nfl/stat/opp-1st-quarter-points-per-game", "Opponent Q1 Points Per Game"],
        ["https://www.teamrankings.com/nfl/stat/passing-yards-per-game", "Passing Yards Per Game"],
        ["https://www.teamrankings.com/nfl/stat/passing-touchdowns-per-game", "Passing TDs Per Game"],
        ["https://www.teamrankings.com/nfl/stat/rushing-yards-per-game", "Rushing Yards Per Game"],
        ["https://www.teamrankings.com/nfl/stat/rushing-touchdowns-per-game", "Rushing TDs Per Game"],
        ["https://www.teamrankings.com/nfl/stat/interceptions-thrown-per-game", "Interceptions Thrown Per Game"],
        ["https://www.teamrankings.com/nfl/stat/interceptions-per-game", "Opponent Interceptions Thrown Per Game"],
        ["https://www.teamrankings.com/nfl/stat/points-per-game", "Points Per Game"],
        ["https://www.teamrankings.com/nfl/stat/opponent-points-per-game", "Opponent Points Per Game"],
        ["https://www.teamrankings.com/nfl/stat/sacks-per-game", "Sacks Per Game"],
        ["https://www.teamrankings.com/nfl/stat/qb-sacked-per-game", "Opponent Sacks Per Game"],
        ["https://www.teamrankings.com/nfl/stat/defensive-touchdowns-per-game", "Defensive TDs Per Game"],
        ["https://www.teamrankings.com/nfl/stat/opponent-defensive-touchdowns-per-game", "Opponent Defensive TDs Per Game"]
     ]
    
    print('Starting scraper... \n')
    
    for link in links:
    
        # create a soup table
        data_table = datascraper.get_first_table(link[0]) # this will select the table on the site

        # select these names of the columns based on the header table
        column_names = datascraper.list_of_headers(data_table)

        # create data frame from the website table
        final_data_frame = datascraper.create_df(soup_table=data_table, list_of_column_names=column_names)
    
#        # do you want to save the data frame to excel workbook?
#        save_decision = input('Do you want to save table to an excel worksheet? (Y/N)' ).upper()
#        if save_decision == 'Y':
#            path_decision = input('Do you want to use your current directory {}? (Y/N) '.format(os.getcwd()) ).upper()
#            if path_decision == 'Y':
#                save_dir = os.getcwd()
#            else:
#                save_dir = input('Please enter the full path of the save location: ')
#            save_file = input('Please enter a file name (with no extension): ')
        save_dir = "/Users/vatsan/Documents/Code/NFL_Stats/"
        save_file = link[1]
        try:
            datascraper.save_df(final_data_frame, save_dir, save_file)
        except:
            print('I don\'t think the file saved, you should double check.')
            
    print('Done.'.format(save_dir))
    
    
if __name__ == '__main__':
#    
#    try:
#        main(sys.argv[1])
#    except IndexError as e:
#        url = input('Please enter url: ' )
#        main(url)
    main()

