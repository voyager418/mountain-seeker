# adapted from https://medium.com/geekculture/implementing-the-most-popular-indicator-on-tradingview-using-python-239d579412ab
import pandas as pd
import numpy as np
import sys

def squeeze_indicator(df, length = 20, mult = 2, length_KC = 20, mult_KC = 1.5):
	#df['ohlc4'] = (df['Close'] + df['Open'] + df['High'] + df['Low'])/4.
	df['ohlc4'] = df['Close']
	# calculate BB
	m_avg1 = df['ohlc4'].rolling(window=length).mean()
	m_avg2 = df['ohlc4'].rolling(window=length_KC).mean()

	#range_ma
	df['tr'] = df["High"] - df["Low"]
	range_ma = df['tr'].rolling(window=length_KC).mean()

	m_std = df['ohlc4'].rolling(window=length).std(ddof=0)
	dev = mult * m_std

	df['upper_BB'] = m_avg1 + dev
	df['lower_BB'] = m_avg1 - dev

	# calculate KC
	df['upper_KC'] = m_avg2 + range_ma * mult_KC
	df['lower_KC'] = m_avg2 - range_ma * mult_KC

	# calculate bar value
	df['hl2'] = (df['High'] + df['Low'])/2.
	highest = df['hl2'].rolling(window = length_KC).max()
	lowest = df['Low'].rolling(window = length_KC).min()
	sma_hl2 = df['hl2'].rolling(window = length_KC).mean()
	m1 = (highest + lowest)/2.
	df['value'] = (df['ohlc4'] - (m1 + sma_hl2)/2.)
	fit_y = np.array(range(0,length_KC))
	df['value'] = df['value'].rolling(window = length_KC).apply(lambda x: 
														np.polyfit(fit_y, x, 1)[0] * (length_KC-1) + 
														np.polyfit(fit_y, x, 1)[1], raw=True)

	# check for 'squeeze'
	df['squeeze_on'] = (df['lower_BB'] > df['lower_KC']) & (df['upper_BB'] < df['upper_KC'])
	df['squeeze_off'] = (df['lower_BB'] < df['lower_KC']) & (df['upper_BB'] > df['upper_KC'])

	return df


if __name__ == '__main__':
	# parameter setup
	length = 20
	mult = 2
	length_KC = 20
	mult_KC = 1.5

	data = sys.argv[1].split(',')
	data = [data[x:x+6] for x in range(0, len(data), 6)]
	df = pd.DataFrame(data, columns=['Timestamp', 'Open', 'High', 'Low', 'Close', 'Volume']).astype('float')

	df = squeeze_indicator(df, length, mult, length_KC, mult_KC)

	values = df['value'].values.tolist()

	# add colors for the 'value bar'
	colors = []
	for ind, val in enumerate(df['value']):
		if ind == 0:
			if val >= 0:
				color = "lime"
			else:
				color = "red"
		else:
			if val >= 0:
				color = "green"
				if val > df['value'][ind-1]:
					color = "lime"
			else:
				color = "maroon"
				if val < df['value'][ind-1]:
					color = "red"
		colors.append(color)

	print([values, colors])
	sys.stdout.flush()



# # buying window for long position:
# # 1. black cross becomes gray (the squeeze is released)
# long_cond1 = (df['squeeze_off'][-2] == False) & (df['squeeze_off'][-1] == True) 
# # 2. bar value is positive => the bar is light green k
# long_cond2 = df['value'][-1] > 0
# enter_long = long_cond1 and long_cond2

# # buying window for short position:
# # 1. black cross becomes gray (the squeeze is released)
# short_cond1 = (df['squeeze_off'][-2] == False) & (df['squeeze_off'][-1] == True) 
# # 2. bar value is negative => the bar is light red 
# short_cond2 = df['value'][-1] < 0
# enter_short = short_cond1 and short_cond2