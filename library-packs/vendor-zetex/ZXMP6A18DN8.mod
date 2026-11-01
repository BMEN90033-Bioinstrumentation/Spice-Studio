*
*Zetex ZXMP6A18DN8 Spice Model v2.0 Last Revised 21/2/05
*
.SUBCKT ZXMP6A18DN8 30 40 50
*                D G S
M1 6 2 5 5 Pmod L=1.2E-6 W=2.64 
M2 5 2 5 6 Nmod L=1.4E-6 W=1.5 
RG 4 2 5
RIN 2 5 1E9
RD 3 6 Rdmod 0.03
RL 3 5 3E9
C1 2 5 25E-12
C2 3 4 15E-12
D1 3 5  Dbodymod
LD 3 30 1.5E-9
LG 4 40 1.2E-9
LS 5 50 1.2E-9
.MODEL Pmod PMOS (LEVEL=3 TOX=5.5E-8 NSUB=.5E17
+VTO=-1.83 KP=1.9E-5 RS=.035 NFS=2E11 KAPPA=0.06 UO=650 IS=1E-15 N=10)
.MODEL Nmod NMOS (LEVEL=3 TOX=5.5E-8 NSUB=1E16
+TPG=-1 IS=1E-15 N=10)
.MODEL Dbodymod D (IS=1.6E-12 RS=.022 IKF=1 TRS1=1.5e-3
+CJO=65e-12  BV=66)
.MODEL Rdmod RES (TC1=9e-3 TC2=3.9E-5)
.ENDS   ZXMP6A18DN8
*
*$
*
*                (c)  2005 Zetex Semiconductors plc
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
