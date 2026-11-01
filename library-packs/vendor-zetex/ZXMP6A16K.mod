*
*ZETEX ZXMP6A16K Spice Model v1.0 Last Revised 15/3/2007
*
.SUBCKT ZXMP6A16K 30 40 50
*                D G S
M1 6 2 5 5 Pmod L=1.4E-6 W=2.148
M2 5 2 5 6 Nmod L=1.4E-6 W=1.579
RG 4 2 1.9
RIN 2 5 1E9
RD 3 6 Rdmod 0.04
RL 3 5 7E9
D1 3 5  Dbodymod
LD 3 30 1.3E-9
LG 4 40 2.4E-9
LS 5 50 2.4E-9
.MODEL Pmod PMOS (LEVEL=3 TOX=10.7E-8 NSUB=6.6E15
+VTO=-2.24 KP=1.4E-5 RS=.03 NFS=1E11 KAPPA=.005 UO=650 IS=1E-15 N=10)
.MODEL Nmod NMOS (LEVEL=3 TOX=10.7E-8 NSUB=6.45E15 
+TPG=-1 IS=1E-15 N=10)
.MODEL Dbodymod D (IS=5E-12 RS=.02 IKF=0.02 TRS1=1.5e-3 CJO=380e-12 
+M=0.43 VJ=0.41 TT=3.2e-8  BV=110)
.MODEL Rdmod RES (TC1=7e-3 TC2=1.0E-5)
.ENDS
*
*$
*                (c)  2007 Zetex Semiconductors plc
*
*   The copyright in these models  and  the designs embodied belong
*   to Zetex Semiconductors plc (" Zetex ").  They  are  supplied
*   free of charge by Zetex for the purpose of research and design
*   and may be used or copied intact  (including this notice)  for
*   that purpose only.  All other rights are reserved. The models
*   are believed accurate but  no condition  or warranty  as to their
*   merchantability or fitness for purpose is given and no liability
*   in respect of any use is accepted by Zetex PLC, its distributors
*   or agents.
*
*   Zetex Semiconductors plc, Zetex Technology Park, Chadderton,
*   Oldham, United Kingdom, OL9 9LL
